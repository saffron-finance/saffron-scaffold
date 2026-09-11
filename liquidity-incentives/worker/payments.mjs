import { verifyPayment,paymentData } from '../server/payment-proof.mjs'
import { CHAIN_ID } from '../shared/vault-lifecycle.mjs'

/** Keyless canonical block watcher. Lost browser callbacks do not lose payments:
 * native ETH calldata identifies a stored quote; the ordinary verifier checks
 * exact amount/sender/recipient and the same atomic admission path queues it.
 * A cursor advances only after processing the entire canonical block. Restarts
 * replay safely; a reorg resets to the pinned start, never assumes finality.
 * This component cannot create a wallet or send a transaction. */
export function createPaymentWatcher({database:db,rpc,startBlock,confirmations=2,maxBlocks=50,id='native-eth-v1'}){
  if(!/^[0-9]+$/.test(String(startBlock))||!Number.isInteger(confirmations)||confirmations<2||!Number.isInteger(maxBlocks)||maxBlocks<1||maxBlocks>500||!/^[-a-z0-9]{1,64}$/.test(id))throw new Error('Invalid payment watcher policy.')
  const start=BigInt(startBlock)
  return {async tick(){
    await db.ready
    const client=await db.pool.connect(),key='saffron-payment-scan:'+id
    let locked=false
    try{
      locked=(await client.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked',[key])).rows[0].locked
      if(!locked)return {state:'locked'}
      if(BigInt(await rpc('eth_chainId',[]))!==BigInt(CHAIN_ID))throw new Error('Wrong payment chain.')
      await db.query(`INSERT INTO saffron_incentives.payment_scan_cursors(id,chain_id,start_block) VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,[id,CHAIN_ID,start.toString()])
      let cursor=(await db.query('SELECT * FROM saffron_incentives.payment_scan_cursors WHERE id=$1',[id])).rows[0]
      if(BigInt(cursor.start_block)!==start||cursor.chain_id!==CHAIN_ID)throw new Error('Payment watcher cannot change its pinned start or chain.')
      if(cursor.block_number!==null){
        const canonical=await rpc('eth_getBlockByNumber',['0x'+BigInt(cursor.block_number).toString(16),false])
        if(canonical?.hash!==cursor.block_hash){
          await db.reopenCheckoutSettlements(id)
          await db.query('UPDATE saffron_incentives.payment_scan_cursors SET block_number=NULL,block_hash=NULL,updated_at=NOW() WHERE id=$1',[id])
          return {state:'reorg-reset',startBlock:start.toString()}
        }
        await db.settleCheckouts(id,canonical)
      }
      // Additive upgrade for native quotes created before the index existed.
      // Never reads/imports the old Arbitrum receipt schema.
      const unindexed=(await db.query("SELECT id,body FROM saffron_incentives.deployment_quotes WHERE payment_commitment IS NULL AND body ? 'fee' LIMIT 1000")).rows
      for(const q of unindexed)await db.query('UPDATE saffron_incentives.deployment_quotes SET payment_commitment=$2 WHERE id=$1 AND payment_commitment IS NULL',[q.id,paymentData(q.body)])
      if(unindexed.length===1000)return {state:'indexing'}
      const safeHead=BigInt(await rpc('eth_blockNumber',[]))-BigInt(confirmations-1)
      let next=cursor.block_number===null?start:BigInt(cursor.block_number)+1n,previousHash=cursor.block_hash,scanned=0,accepted=0,attention=0,rejected=0
      while(next<=safeHead&&scanned<maxBlocks){
        const tag='0x'+next.toString(16),block=await rpc('eth_getBlockByNumber',[tag,true])
        if(!block?.hash||BigInt(block.number)!==next||!Array.isArray(block.transactions))throw new Error('Payment scan block unavailable.')
        if(previousHash&&block.parentHash!==previousHash){
          await db.reopenCheckoutSettlements(id)
          await db.query('UPDATE saffron_incentives.payment_scan_cursors SET block_number=NULL,block_hash=NULL,updated_at=NOW() WHERE id=$1',[id])
          return {state:'reorg-reset',startBlock:start.toString()}
        }
        for(const tx of block.transactions){
          if(!/^0x[0-9a-f]{64}$/i.test(tx.input??''))continue
          const quote=(await db.query('SELECT body FROM saffron_incentives.deployment_quotes WHERE payment_commitment=$1',[tx.input.toLowerCase()])).rows[0]?.body
          if(!quote)continue
          let proof
          try{proof=await verifyPayment(quote,tx.hash,null,rpc,{confirmations,checkCapability:false,allowAmountMismatch:true})}
          catch(error){if(error.status===400){rejected++;continue}throw error}
          // Capability checking is bypassed only for this authenticated onchain
          // sender, never to establish an HTTP session or reveal recovery data.
          try{
            const result=await db.acceptDeployment({wallet:quote.wallet,quoteId:quote.id,payment:proof,origin:quote.origin})
            if(!result.replayed)accepted++
          }catch(error){
            if(![409,429].includes(error.status))throw error
            await db.query("UPDATE saffron_incentives.payment_proofs SET state='needs_attention',error='Verified fee retained; admission requires operator review.' WHERE hash=$1",[proof.hash])
            if(proof.exactAmount!==false){const row=await db.paymentObligation(proof.hash);if(row?.kind!=='duplicate-fee')await db.paymentAttention(proof.hash,proof.late?'late-fee':'policy-blocked')}
            attention++
          }
        }
        if((await rpc('eth_getBlockByNumber',[tag,false]))?.hash!==block.hash)throw new Error('Payment scan block changed.')
        // Assert the session lock remains alive before checkpointing any work.
        await client.query('SELECT 1')
        await db.query('UPDATE saffron_incentives.payment_scan_cursors SET block_number=$2,block_hash=$3,updated_at=NOW() WHERE id=$1',[id,next.toString(),block.hash])
        await db.settleCheckouts(id,block)
        previousHash=block.hash;scanned++;next++
      }
      await db.query('UPDATE saffron_incentives.payment_scan_cursors SET checked_at=NOW(),safe_head=$2 WHERE id=$1',[id,safeHead.toString()])
      return {state:'scanned',scanned,accepted,attention,rejected,nextBlock:next.toString(),safeHead:safeHead.toString()}
    }finally{try{if(locked)await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[key])}finally{client.release()}}
  }}
}
