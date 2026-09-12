import { fault } from '../shared/incentives.mjs'
const s='saffron_incentives'

/** A clock cannot prove an unpaid checkout is safe to release. Only the keyless
 * watcher's canonical, fully processed watermark can settle its payment window. */
export function createCheckoutReservations(db){
  return {
    async rawHolds(client,budgetId,excludeQuote=null){
      return BigInt((await client.query(`SELECT COALESCE(sum(hold_raw),0)::text value FROM ${s}.deployment_quotes
        WHERE budget_pool_id=$1 AND hold_state IN ('held','closing') AND ($2::uuid IS NULL OR id<>$2)`,[budgetId,excludeQuote])).rows[0].value)
    },
    async pendingSlots(client,wallet){
      return (await client.query(`SELECT count(*)::int total,count(*) FILTER(WHERE wallet=$1)::int wallet FROM (
        SELECT wallet FROM ${s}.deployment_quotes WHERE hold_state IN ('held','closing')
        UNION ALL SELECT wallet FROM ${s}.deployment_intents WHERE status NOT IN ('active','completed','retired')) slots`,[wallet])).rows[0]
    },
    async checkoutWatermarks(){
      return (await db.query(`SELECT DISTINCT c.id,c.block_number,c.block_hash FROM ${s}.payment_scan_cursors c
        JOIN ${s}.deployment_quotes q ON q.settled_cursor=c.id WHERE q.hold_state='released'`)).rows
    },
    async settleCheckouts(cursorId,block){
      if(!/^0x[0-9a-f]+$/i.test(block?.number??'')||!/^0x[0-9a-f]{64}$/i.test(block?.hash??'')||!/^0x[0-9a-f]+$/i.test(block?.timestamp??''))throw fault(503,'Canonical checkout settlement evidence is unavailable.')
      const timestamp=Number(BigInt(block.timestamp))*1000
      if(!Number.isSafeInteger(timestamp))throw fault(503,'Invalid settlement timestamp.')
      return db.transaction(async client=>{
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
        const cursor=(await client.query(`SELECT * FROM ${s}.payment_scan_cursors WHERE id=$1 FOR UPDATE`,[cursorId])).rows[0]
        if(!cursor||cursor.block_number!==BigInt(block.number).toString()||cursor.block_hash!==block.hash)throw fault(409,'Payment watermark changed before checkout settlement.')
        const candidates=(await client.query(`SELECT DISTINCT q.budget_pool_id FROM ${s}.deployment_quotes q
          WHERE q.hold_state IN ('held','closing') AND q.expires_at<$1 AND q.sizing_block>=$2
          AND NOT EXISTS(SELECT 1 FROM ${s}.payment_proofs p WHERE p.quote_id=q.id AND p.state<>'refunded') ORDER BY q.budget_pool_id`,[new Date(timestamp),cursor.start_block])).rows
        let released=0
        for(const {budget_pool_id:id} of candidates){
          await db.lockBudget(client,id)
          released+=(await client.query(`UPDATE ${s}.deployment_quotes q SET hold_state='released',settled_cursor=$2,settled_block=$3,settled_hash=$4
            WHERE budget_pool_id=$1 AND hold_state IN ('held','closing') AND expires_at<$5 AND sizing_block>=$6
            AND NOT EXISTS(SELECT 1 FROM ${s}.payment_proofs p WHERE p.quote_id=q.id AND p.state<>'refunded')`,[id,cursorId,cursor.block_number,block.hash,new Date(timestamp),cursor.start_block])).rowCount
        }
        return {released}
      })
    },
    async reopenCheckoutSettlements(cursorId){
      await db.transaction(async client=>{
        await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
        const budgets=(await client.query(`SELECT DISTINCT budget_pool_id FROM ${s}.deployment_quotes WHERE settled_cursor=$1 AND hold_state='released' ORDER BY budget_pool_id`,[cursorId])).rows
        for(const {budget_pool_id:id} of budgets){
          await db.lockBudget(client,id)
          await client.query(`UPDATE ${s}.budget_pools SET reconciliation_required=TRUE WHERE id=$1`,[id])
          await client.query(`UPDATE ${s}.deployment_quotes SET hold_state='closing' WHERE budget_pool_id=$1 AND settled_cursor=$2 AND hold_state='released'`,[id,cursorId])
        }
      })
    },
  }
}
