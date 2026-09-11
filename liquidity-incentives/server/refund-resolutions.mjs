import { randomUUID } from 'node:crypto'
import { digest,fault } from '../shared/incentives.mjs'
const s='saffron_incentives'
export function createRefundResolutions(db){
  async function locked(client,hash){
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
    const payment=await db.paymentObligation(hash,client)
    if(!payment)throw fault(404,'Received payment not found.')
    const quote=await db.quote(payment.quote_id)
    await db.lockBudget(client,quote.budgetPoolId)
    const row=(await client.query(`SELECT * FROM ${s}.payment_obligations WHERE hash=$1 FOR UPDATE`,[hash])).rows[0]
    return {row,quote}
  }
  async function apply(client,row,quote){
    const transfers=(await client.query(`SELECT * FROM ${s}.refund_transfers WHERE payment_hash=$1`,[row.hash])).rows
    const refunded=transfers.filter(t=>t.state==='confirmed').reduce((sum,t)=>sum+BigInt(t.amount_wei),0n)
    const orphaned=transfers.some(t=>t.state==='orphaned')||refunded>BigInt(row.amount_wei)
    const state=orphaned?'reconciliation_required':refunded===BigInt(row.amount_wei)?'refunded':transfers.some(t=>t.state==='confirming')?'confirming':'refund_due'
    await client.query(`UPDATE ${s}.payment_obligations SET state=$2,revision=revision+1,updated_at=NOW() WHERE hash=$1`,[row.hash,state])
    await client.query(`UPDATE ${s}.payment_proofs SET state=$2 WHERE hash=$1`,[row.hash,state==='refunded'?'refunded':'needs_attention'])
    if(orphaned){
      await client.query(`UPDATE ${s}.budget_pools SET reconciliation_required=TRUE WHERE id=$1`,[quote.budgetPoolId])
      // Reopen only a quote whose own original fee controlled its release.
      await client.query(`UPDATE ${s}.deployment_quotes SET hold_state='closing' WHERE id=$1 AND hold_state='released'
        AND EXISTS(SELECT 1 FROM ${s}.payment_proofs WHERE hash=$2)`,[quote.id,row.hash])
    }
    return {hash:row.hash,state,revision:row.revision+1,refundedWei:refunded.toString(),outstandingWei:(refunded<BigInt(row.amount_wei)?BigInt(row.amount_wei)-refunded:0n).toString()}
  }
  return {
    async recordRefund(hash,transfer,resolution){
      return db.transaction(async client=>{
        const {row,quote}=await locked(client,hash)
        const replay=await db.resolutionReplay(client,hash,'record-refund',resolution,{hash:transfer.hash})
        if(replay.replayed)return replay.replayed
        if(row.revision!==resolution.revision||!['refund_due','confirming','reconciliation_required'].includes(row.state)||row.execution_allowed)throw fault(409,'Payment resolution changed. Refresh before recording a refund.')
        const original=(await client.query(`SELECT j.state,j.lease_until FROM ${s}.vault_jobs j JOIN ${s}.deployment_intents i ON i.id=j.intent_id
          JOIN ${s}.payment_proofs p ON p.quote_id=i.quote_id WHERE p.hash=$1 FOR UPDATE OF j`,[hash])).rows[0]
        if(original&&(original.state!=='retired'||original.lease_until>new Date(db.now())))throw fault(409,'Reconcile and retire the original request before recording a refund.')
        if((await client.query(`SELECT 1 FROM ${s}.refund_evidence WHERE hash=$1`,[transfer.hash])).rowCount)throw fault(409,'This refund transaction has already been allocated.')
        const allocated=BigInt((await client.query(`SELECT COALESCE(sum(amount_wei),0)::text amount FROM ${s}.refund_transfers WHERE payment_hash=$1 AND state<>'failed'`,[hash])).rows[0].amount)
        if(allocated+BigInt(transfer.amountWei)>BigInt(row.amount_wei))throw fault(409,'Refund exceeds the unallocated received amount. Reconcile pending transfers first.')
        await client.query(`INSERT INTO ${s}.refund_transfers(hash,payment_hash,amount_wei,state,evidence) VALUES($1,$2,$3,$4,$5)`,[transfer.hash,hash,transfer.amountWei,transfer.state,transfer])
        await client.query(`INSERT INTO ${s}.refund_evidence(hash,transfer_hash) VALUES($1,$1)`,[transfer.hash])
        const result=await apply(client,row,quote)
        await db.auditPaymentResolution(client,hash,'record-refund',resolution,replay.fingerprint,result,transfer)
        return result
      })
    },
    async replaceRefund(hash,originalHash,evidence,resolution){
      return db.transaction(async client=>{
        const {row,quote}=await locked(client,hash),terms={originalHash,hash:evidence.hash}
        const replay=await db.resolutionReplay(client,hash,'replace-refund',resolution,terms)
        if(replay.replayed)return replay.replayed
        if(row.revision!==resolution.revision||!['refund_due','confirming','reconciliation_required'].includes(row.state))throw fault(409,'Payment resolution changed. Refresh before reconciling a refund.')
        const transfer=(await client.query(`SELECT * FROM ${s}.refund_transfers WHERE hash=$1 AND payment_hash=$2 FOR UPDATE`,[originalHash,hash])).rows[0]
        if(!transfer||transfer.state==='confirmed'||evidence.sender!==transfer.evidence.sender||evidence.nonce!==transfer.evidence.nonce)throw fault(409,'The saved refund no longer needs this reconciliation.')
        if((await client.query(`SELECT 1 FROM ${s}.refund_evidence WHERE hash=$1`,[evidence.hash])).rowCount)throw fault(409,'This replacement is already allocated.')
        await client.query(`INSERT INTO ${s}.refund_evidence(hash,transfer_hash) VALUES($1,$2)`,[evidence.hash,originalHash])
        await client.query(`UPDATE ${s}.refund_transfers SET resolved_hash=$2,evidence=$3,state=$4,checked_at=NOW() WHERE hash=$1`,[originalHash,evidence.hash,evidence,evidence.state])
        const result=await apply(client,row,quote)
        await db.auditPaymentResolution(client,hash,'replace-refund',resolution,replay.fingerprint,result,evidence)
        return result
      })
    },
    async observeRefund(hash,evidence,state){
      const saved=(await db.query(`SELECT * FROM ${s}.refund_transfers WHERE hash=$1`,[hash])).rows[0]
      if(!saved)return
      return db.transaction(async client=>{
        const {row,quote}=await locked(client,saved.payment_hash)
        const current=(await client.query(`SELECT * FROM ${s}.refund_transfers WHERE hash=$1 FOR UPDATE`,[hash])).rows[0]
        if(current.state===state&&digest(current.evidence)===digest(evidence)){
          await client.query(`UPDATE ${s}.refund_transfers SET checked_at=NOW() WHERE hash=$1`,[hash]);return
        }
        await client.query(`UPDATE ${s}.refund_transfers SET state=$2,evidence=$3,checked_at=NOW() WHERE hash=$1`,[hash,state,evidence])
        const result=await apply(client,row,quote)
        const resolution={operator:'observer',requestKey:randomUUID(),revision:row.revision,reason:'Canonical refund observation changed.'}
        await db.auditPaymentResolution(client,row.hash,'observe-refund',resolution,digest({hash,evidence,state}),result,evidence)
        return result
      })
    },
  }
}
