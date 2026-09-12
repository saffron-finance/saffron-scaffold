import { randomUUID } from 'node:crypto'
import { decodeFunctionResult,encodeFunctionData,keccak256 } from 'viem'
import { digest,fault,validAddress } from '../shared/incentives.mjs'
import { abi,sameAddress } from '../shared/vault-lifecycle.mjs'
import { readVault } from '../shared/vault-reader.mjs'
import { verifyRefund,refundCsv,BULKSENDER } from './refund-proof.mjs'
const s='saffron_incentives',uuid=/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i,hashPattern=/^0x[0-9a-f]{64}$/i
const creditSql=`SELECT COALESCE(sum(a.amount_wei),0)::text AS amount FROM ${s}.refund_allocations a JOIN ${s}.refund_payouts p USING(hash,payout_index) WHERE a.payment_hash=$1 AND p.canonical`
const fail=message=>{throw fault(409,message)}
async function locks(client){await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))");await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-refunds',0))")}

/** The API prepares/verifies externally paid refunds; it never signs or sends.
 * Global admission/journal locks serialize the execution stop and allocation. */
export function createRefunds({db,rpc,confirmations=2,now=Date.now,verify=verifyRefund}) {
  async function obligation(hash){const row=await db.paymentObligation(hash);if(!row)throw fault(404,'Creation payment not found.');return row}
  async function request(row){const id=(await db.query(`SELECT id FROM ${s}.deployment_intents WHERE quote_id=$1`,[row.quote_id])).rows[0]?.id;return id?db.getIntent(id):null}
  async function credit(hash,client=db){return BigInt((await client.query(creditSql,[hash])).rows[0].amount)}
  async function noPosition(job,reason){
    if(!job?.plan.vault){if(reason==='funding_unavailable')fail('A funding exception requires a created vault.');return null}
    // An uninitialized vault cannot accept a fixed deposit. Its code and
    // canonical initialization flag still have to match the creation journal.
    const head=BigInt(await rpc('eth_blockNumber',[])),tag='0x'+(head-BigInt(confirmations-1)).toString(16)
    const block=await rpc('eth_getBlockByNumber',[tag,false])
    if(BigInt(await rpc('eth_chainId',[]))!==4663n||!block?.hash||keccak256(await rpc('eth_getCode',[job.plan.vault,tag]))!==job.plan.vaultCodeHash)fail('Vault identity is unavailable for refund review.')
    const initialized=decodeFunctionResult({abi,functionName:'initialized',data:await rpc('eth_call',[{to:job.plan.vault,data:encodeFunctionData({abi,functionName:'initialized'})},tag])})
    if(!initialized){if(reason==='funding_unavailable')fail('Vault initialization is incomplete.');if((await rpc('eth_getBlockByNumber',[tag,false]))?.hash!==block.hash)fail('Vault block changed.');return null}
    const snapshot=await readVault(job,rpc,{confirmations,now})
    if(reason==='deployment_failed'&&job.state==='created')fail('Creation is complete. Use the funding exception reason if its required premium cannot be provided.')
    if(snapshot.isStarted||BigInt(snapshot.claimSupply)>0n||BigInt(snapshot.adapterLiquidity)>0n)fail('A deposited position must keep its protocol claim and withdrawal rights; this request cannot enter the unfulfilled refund flow.')
    if(reason==='funding_unavailable'&&BigInt(snapshot.variableSupply)>=BigInt(snapshot.variableCapacity)&&BigInt(snapshot.variableBalance)>=BigInt(snapshot.variableCapacity))fail('The required premium is already funded.')
    return snapshot
  }
  async function executionEvidence(row){
    const job=await request(row);if(!job)fail('Only an accepted creation request can use this refund policy.')
    if(job.lease_until&&job.lease_until.getTime()>now())fail('Wait for the creator lease to finish before preparing or closing a refund.')
    const journal=await db.execution.transactionMetadata(job.id),entries=[]
    for(const saved of journal){
      const hash=saved.resolved_hash??saved.hash
      const [receipt,tx,head,nonce]=await Promise.all([rpc('eth_getTransactionReceipt',[hash]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_blockNumber',[]),rpc('eth_getTransactionCount',[job.signer,'latest'])])
      if(!receipt||!tx||BigInt(head)<BigInt(receipt.blockNumber)+BigInt(confirmations-1)||BigInt(nonce)<=BigInt(saved.nonce))fail('A signed creator transaction or nonce still needs reconciliation.')
      const intended=saved.transaction_data
      const matches=saved.resolution_kind==='cancelled'?sameAddress(tx.to,job.signer)&&tx.input==='0x'&&BigInt(tx.value)===0n
        :sameAddress(tx.to,intended.to)&&tx.input===intended.data&&BigInt(tx.value)===BigInt(intended.value)
      if(!matches||!sameAddress(tx.from,job.signer)||BigInt(tx.nonce)!==BigInt(saved.nonce)||tx.hash?.toLowerCase()!==hash.toLowerCase()
        ||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()||tx.blockHash!==receipt.blockHash||!['0x0','0x1'].includes(receipt.status)
        ||(await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]))?.hash!==receipt.blockHash)fail('Creator transaction evidence changed.')
      entries.push({hash,nonce:String(saved.nonce),blockHash:receipt.blockHash,status:receipt.status})
    }
    const snapshot=await noPosition(job,row.refund_reason)
    return {jobId:job.id,journalCount:journal.length,entries,snapshot,checkedAt:now()}
  }
  async function assertStopped(client,row,evidence){
    const job=(await client.query(`SELECT * FROM ${s}.vault_jobs WHERE intent_id=$1 FOR UPDATE`,[evidence.jobId])).rows[0]
    const intent=(await client.query(`SELECT cancel_requested FROM ${s}.deployment_intents WHERE id=$1`,[evidence.jobId])).rows[0]
    if(row.execution_allowed||!intent?.cancel_requested||job.lease_until?.getTime()>now()||now()-evidence.checkedAt>10_000
      ||Number((await client.query(`SELECT count(*) AS n FROM ${s}.chain_operations WHERE intent_id=$1`,[evidence.jobId])).rows[0].n)!==evidence.journalCount)fail('Creator execution changed; reconcile again before proceeding.')
  }
  async function approve(hash,resolution,{category,fundingStopped}={}){
    if(!['deployment_failed','funding_unavailable'].includes(category)||fundingStopped!==true)throw fault(400,'Select the unfulfillable reason and confirm external funding is stopped.')
    const previous=await db.resolutionReplay(db,hash,'approve-refund',resolution,{category,fundingStopped});if(previous.replayed)return previous.replayed
    const row=await obligation(hash),job=await request(row);if(!job)fail('Resolve unadmitted or duplicate payments through the separate payment exception process.')
    await noPosition(job,category)
    return db.transaction(async client=>{
      await locks(client)
      const replay=await db.resolutionReplay(client,hash,'approve-refund',resolution,{category,fundingStopped})
      if(replay.replayed)return replay.replayed
      const current=(await client.query(`SELECT * FROM ${s}.payment_obligations WHERE hash=$1 FOR UPDATE`,[hash])).rows[0]
      if(current.revision!==resolution.revision||!['admitted','needs_attention'].includes(current.state))fail('Refund eligibility or revision changed. Refresh the payment.')
      await client.query(`UPDATE ${s}.payment_obligations SET state='refund_pending',execution_allowed=FALSE,refund_reason=$2,revision=revision+1,updated_at=NOW() WHERE hash=$1`,[hash,category])
      await client.query(`UPDATE ${s}.deployment_intents SET cancel_requested=TRUE,status='refund_pending',updated_at=NOW() WHERE id=$1`,[job.id])
      const result={paymentHash:hash,state:'refund_pending',amountWei:row.amount_wei,revision:row.revision+1}
      await db.auditPaymentResolution(client,hash,'approve-refund',resolution,replay.fingerprint,result,{category,fundingStopped,jobId:job.id})
      return result
    })
  }
  async function prepare({payments,source,requestKey},actor){
    if(!uuid.test(requestKey??'')||!validAddress(source)||/^0x0{40}$/i.test(source)||!Array.isArray(payments)||payments.length<1||payments.length>100
      ||payments.some(hash=>!hashPattern.test(hash))||new Set(payments).size!==payments.length)throw fault(400,'Provide a unique batch ID, refund source and 1–100 approved payments.')
    payments=payments.map(hash=>hash.toLowerCase()).sort();source=source.toLowerCase()
    const fingerprint=digest({payments,source,actor})
    const existing=(await db.query(`SELECT * FROM ${s}.refund_batches WHERE id=$1`,[requestKey])).rows[0]
    if(existing){if(existing.fingerprint!==fingerprint)fail('Batch ID already binds different terms.');return detail(requestKey)}
    const evidence=new Map()
    for(const hash of payments){const row=await obligation(hash);if(!['refund_pending','refund_exception'].includes(row.state))fail('Payment is not approved for refund.');evidence.set(hash,await executionEvidence(row))}
    const afterBlock=await rpc('eth_blockNumber',[])
    if(BigInt(await rpc('eth_chainId',[]))!==4663n||!/^0x[0-9a-f]+$/i.test(afterBlock))fail('Refund preparation requires a Robinhood chain head.')
    await db.transaction(async client=>{
      await locks(client)
      if((await client.query(`SELECT 1 FROM ${s}.refund_batches WHERE id=$1`,[requestKey])).rowCount)fail('Batch was prepared concurrently. Reload it.')
      const items=[],grouped=new Map()
      for(const hash of payments){
        const row=(await client.query(`SELECT * FROM ${s}.payment_obligations WHERE hash=$1 FOR UPDATE`,[hash])).rows[0]
        await assertStopped(client,row,evidence.get(hash))
        if((await client.query(`SELECT 1 FROM ${s}.refund_items i JOIN ${s}.refund_batches b ON b.id=i.batch_id WHERE i.payment_hash=$1 AND b.state<>'superseded'`,[hash])).rowCount)fail('An existing manifest already covers this payment. Reconcile its submissions before preparing a remainder.')
        const amount=BigInt(row.amount_wei)-await credit(hash,client);if(amount<=0n)fail('This creation fee is already repaid.')
        if(sameAddress(row.wallet,source))fail('The refund source must differ from the original payer.')
        items.push({hash,wallet:row.wallet,amountWei:amount.toString(),originalWei:row.amount_wei,revision:row.revision,reason:row.refund_reason})
        grouped.set(row.wallet,(grouped.get(row.wallet)??0n)+amount)
      }
      const recipients=[...grouped].map(([wallet,amount])=>({wallet,amountWei:amount.toString()}))
      const manifest={version:1,chainId:4663,source,afterBlock,sender:BULKSENDER.address,author:actor,items,recipients}
      await client.query(`INSERT INTO ${s}.refund_batches(id,actor,source,fingerprint,manifest) VALUES($1,$2,$3,$4,$5)`,[requestKey,actor,source,fingerprint,manifest])
      for(const item of items)await client.query(`INSERT INTO ${s}.refund_items(batch_id,payment_hash,expected_wei) VALUES($1,$2,$3)`,[requestKey,item.hash,item.amountWei])
    })
    return detail(requestKey)
  }
  async function detail(id){
    if(!uuid.test(id??''))throw fault(400,'Invalid refund batch ID.')
    const batch=(await db.query(`SELECT * FROM ${s}.refund_batches WHERE id=$1`,[id])).rows[0];if(!batch)throw fault(404,'Refund batch not found.')
    const items=[];for(const item of batch.manifest.items){const row=await obligation(item.hash),paid=await credit(item.hash);items.push({...item,state:row.state,closureError:row.refund_error,verifiedWei:paid.toString(),outstandingWei:(BigInt(row.amount_wei)-paid).toString()})}
    const submissions=(await db.query(`SELECT hash,state,error,checked_at FROM ${s}.refund_submissions WHERE batch_id=$1 ORDER BY created_at,hash`,[id])).rows
    const unmatched=(await db.query(`SELECT p.hash,p.payout_index,p.recipient,(p.amount_wei-COALESCE(sum(a.amount_wei),0))::text AS amount_wei FROM ${s}.refund_payouts p
      JOIN ${s}.refund_submissions t ON t.hash=p.hash LEFT JOIN ${s}.refund_allocations a ON a.hash=p.hash AND a.payout_index=p.payout_index
      WHERE t.batch_id=$1 AND p.canonical GROUP BY p.hash,p.payout_index HAVING p.amount_wei>COALESCE(sum(a.amount_wei),0)`,[id])).rows
    return {id,state:batch.state,manifest:batch.manifest,csv:refundCsv(batch.manifest.recipients),items,submissions,unmatched,outstandingWei:items.reduce((sum,item)=>sum+BigInt(item.outstandingWei),0n).toString()}
  }
  async function submit(id,hashes,actor){
    await detail(id)
    if(!Array.isArray(hashes)||!hashes.length||hashes.length>25||hashes.some(hash=>!hashPattern.test(hash)))throw fault(400,'Provide 1–25 external transaction hashes.')
    await db.transaction(async client=>{
      await locks(client)
      const batch=(await client.query(`SELECT state FROM ${s}.refund_batches WHERE id=$1 FOR UPDATE`,[id])).rows[0]
      if(batch.state==='superseded')fail('This batch was superseded by an explicit remainder.')
      for(const input of hashes){const hash=input.toLowerCase(),previous=(await client.query(`SELECT batch_id FROM ${s}.refund_submissions WHERE hash=$1`,[hash])).rows[0]
        if(previous&&previous.batch_id!==id)fail('That transaction is already assigned to another refund batch.')
        await client.query(`INSERT INTO ${s}.refund_submissions(hash,batch_id,actor) VALUES($1,$2,$3) ON CONFLICT(hash) DO NOTHING`,[hash,id,actor])
      }
      await client.query(`UPDATE ${s}.refund_batches SET state='submitted',updated_at=NOW() WHERE id=$1`,[id])
    });return detail(id)
  }
  async function remainder(id,actor){
    await db.transaction(async client=>{
      await locks(client)
      const batch=(await client.query(`SELECT * FROM ${s}.refund_batches WHERE id=$1 FOR UPDATE`,[id])).rows[0];if(!batch)throw fault(404,'Batch not found.')
      const rows=(await client.query(`SELECT * FROM ${s}.refund_submissions WHERE batch_id=$1`,[id])).rows
      if(!rows.length||rows.some(row=>!['verified','failed','ineligible'].includes(row.state)||!row.checked_at||now()-row.checked_at.getTime()>30_000||row.lease_until?.getTime()>now()))fail('Reconcile every uncertain submission before exporting remaining amounts.')
      await client.query(`UPDATE ${s}.refund_batches SET state='superseded',updated_at=NOW() WHERE id=$1`,[id])
      // Immutable manifests and transaction bindings remain; this action permits
      // a deliberate new batch and never transmits a repeat payout.
      for(const item of batch.manifest.items){const row=await db.paymentObligation(item.hash,client),resolution={operator:actor,revision:row.revision,requestKey:randomUUID(),reason:'Superseded reconciled refund manifest '+id}
        const replay=await db.resolutionReplay(client,item.hash,'refund-remainder',resolution,{batchId:id})
        await db.auditPaymentResolution(client,item.hash,'refund-remainder',resolution,replay.fingerprint,{batchId:id,state:'superseded'})}
    });return detail(id)
  }
  async function settle(hash){
    const row=await obligation(hash);if(!['refund_pending','refund_exception','refunded'].includes(row.state))return
    const paid=await credit(hash)
    if(paid<BigInt(row.amount_wei)){
      if(row.state==='refunded')await db.transaction(async client=>{await locks(client);await client.query(`UPDATE ${s}.payment_obligations SET state='refund_exception',execution_allowed=FALSE,revision=revision+1 WHERE hash=$1 AND state='refunded'`,[hash]);await client.query(`UPDATE ${s}.deployment_intents SET status='refund_exception',cancel_requested=TRUE WHERE quote_id=$1`,[row.quote_id])})
      return
    }
    const evidence=await executionEvidence(row)
    await db.transaction(async client=>{
      await locks(client)
      const current=(await client.query(`SELECT * FROM ${s}.payment_obligations WHERE hash=$1 FOR UPDATE`,[hash])).rows[0]
      await assertStopped(client,current,evidence)
      if(await credit(hash,client)<BigInt(row.amount_wei))return
      if(current.state==='refunded')return
      const job=await db.getIntent(evidence.jobId,client)
      await db.lockBudget(client,job.budget_pool_id)
      const reserved=(await client.query(`SELECT * FROM ${s}.budget_reservations WHERE intent_id=$1 FOR UPDATE`,[job.id])).rows[0]
      // Release only the unallocated remainder. Externally funded premium stays
      // allocated; no refund of a creation fee replenishes spent premium.
      const amount=BigInt(reserved.reserved_raw)
      if(amount>0n){
        await client.query(`UPDATE ${s}.budget_reservations SET released_raw=released_raw+reserved_raw,reserved_raw=0 WHERE intent_id=$1`,[job.id])
        await client.query(`UPDATE ${s}.budget_pools SET reserved_raw=reserved_raw-$2 WHERE id=$1`,[job.budget_pool_id,amount.toString()])
        await db.entry(client,{key:'refund-release:'+hash,budgetId:job.budget_pool_id,intentId:job.id,kind:'refund-release',reserved:-amount,actor:'refund-verifier',evidence:{paymentHash:hash,execution:evidence}})
      }
      await client.query(`UPDATE ${s}.payment_obligations SET state='refunded',refund_error=NULL,execution_allowed=FALSE,revision=revision+1,updated_at=NOW() WHERE hash=$1`,[hash])
      await client.query(`UPDATE ${s}.deployment_intents SET status='refunded',cancel_requested=TRUE,updated_at=NOW() WHERE id=$1`,[job.id])
      await client.query(`UPDATE ${s}.vault_jobs SET state='refunded',operation='observe',updated_at=NOW() WHERE intent_id=$1`,[job.id])
      const author=(await client.query(`SELECT actor FROM ${s}.payment_resolution_audit WHERE payment_hash=$1 AND action='approve-refund' ORDER BY id DESC LIMIT 1`,[hash])).rows[0].actor
      const resolution={operator:author,revision:current.revision,requestKey:randomUUID(),reason:'Full original creation fee canonically repaid; execution reconciled.'}
      const replay=await db.resolutionReplay(client,hash,'close-refund',resolution,evidence)
      await db.auditPaymentResolution(client,hash,'close-refund',resolution,replay.fingerprint,{state:'refunded',verifiedWei:paid.toString()},evidence)
    })
  }
  async function processSubmission(row){
    let proof,error=null
    try{proof=await verify(row.hash,row.source,rpc,{confirmations,afterBlock:row.afterBlock})}catch{proof={state:'unverified'};error='External payout evidence is unavailable or requires review.'}
    await db.transaction(async client=>{
      await locks(client)
      const current=(await client.query(`SELECT * FROM ${s}.refund_submissions WHERE hash=$1 FOR UPDATE`,[row.hash])).rows[0]
      if(current.lease_token!==row.lease_token)return
      const previousAllocations=(await client.query(`SELECT payout_index,payment_hash,amount_wei FROM ${s}.refund_allocations WHERE hash=$1 ORDER BY payout_index,payment_hash`,[row.hash])).rows
      // Rebuild only this transaction's allocations under the global lock. If a
      // reorged payout returns after a replacement paid the obligation, its value
      // becomes visible surplus rather than crediting the original fee twice.
      await client.query(`DELETE FROM ${s}.refund_allocations WHERE hash=$1`,[row.hash])
      await client.query(`UPDATE ${s}.refund_payouts SET canonical=FALSE WHERE hash=$1`,[row.hash])
      if(proof.state==='verified')for(const payout of proof.payouts){
        const old=(await client.query(`SELECT * FROM ${s}.refund_payouts WHERE hash=$1 AND payout_index=$2`,[row.hash,payout.index])).rows[0]
        if(old&&(old.recipient!==payout.recipient||old.amount_wei!==payout.amountWei))fail('Payout identity changed.')
        await client.query(`INSERT INTO ${s}.refund_payouts(hash,payout_index,recipient,amount_wei,canonical,block_number,block_hash,method) VALUES($1,$2,$3,$4,TRUE,$5,$6,$7)
          ON CONFLICT(hash,payout_index) DO UPDATE SET canonical=TRUE,block_number=EXCLUDED.block_number,block_hash=EXCLUDED.block_hash`,[row.hash,payout.index,payout.recipient,payout.amountWei,proof.block.number,proof.block.hash,proof.method])
        let remaining=BigInt(payout.amountWei)-BigInt((await client.query(`SELECT COALESCE(sum(amount_wei),0)::text AS amount FROM ${s}.refund_allocations WHERE hash=$1 AND payout_index=$2`,[row.hash,payout.index])).rows[0].amount)
        const items=(await client.query(`SELECT o.* FROM ${s}.refund_items i JOIN ${s}.payment_obligations o ON o.hash=i.payment_hash WHERE i.batch_id=$1 AND o.wallet=$2 ORDER BY o.hash`,[row.batch_id,payout.recipient])).rows
        for(const item of items){const needed=BigInt(item.amount_wei)-await credit(item.hash,client),amount=needed<remaining?needed:remaining;if(amount<=0n)continue
          await client.query(`INSERT INTO ${s}.refund_allocations(hash,payout_index,payment_hash,amount_wei) VALUES($1,$2,$3,$4) ON CONFLICT(hash,payout_index,payment_hash) DO UPDATE SET amount_wei=${s}.refund_allocations.amount_wei+EXCLUDED.amount_wei`,[row.hash,payout.index,item.hash,amount.toString()]);remaining-=amount}
      }
      const allocations=(await client.query(`SELECT payout_index,payment_hash,amount_wei FROM ${s}.refund_allocations WHERE hash=$1 ORDER BY payout_index,payment_hash`,[row.hash])).rows
      if(digest(current.evidence)!==digest(proof)||digest(previousAllocations)!==digest(allocations))await client.query(`INSERT INTO ${s}.refund_verification_audit(hash,previous_evidence,evidence,previous_allocations,allocations) VALUES($1,$2,$3,$4,$5)`,[row.hash,current.evidence,proof,JSON.stringify(previousAllocations),JSON.stringify(allocations)])
      await client.query(`UPDATE ${s}.refund_submissions SET state=$2,evidence=$3,error=$4,checked_at=NOW(),lease_token=NULL,lease_until=NULL WHERE hash=$1`,[row.hash,proof.state,proof,error])
    })
    for(const item of (await db.query(`SELECT payment_hash FROM ${s}.refund_items WHERE batch_id=$1`,[row.batch_id])).rows)try{await settle(item.payment_hash)}catch(cause){
      await db.query(`UPDATE ${s}.payment_obligations SET refund_error=$2 WHERE hash=$1`,[item.payment_hash,cause.status===409?cause.message:'Execution verification is unavailable; creation remains stopped.'])
    }
  }
  async function poll(){
    // Durable oldest-first queue prevents a large batch from monopolizing a pass.
    // Confirmed payouts are rechecked too, including after process restart.
    const token=randomUUID(),rows=(await db.query(`UPDATE ${s}.refund_submissions SET lease_token=$1,lease_until=NOW()+INTERVAL '60 seconds'
      WHERE hash IN(SELECT hash FROM ${s}.refund_submissions WHERE (lease_until IS NULL OR lease_until<NOW())
        AND (checked_at IS NULL OR checked_at<NOW()-INTERVAL '15 seconds') ORDER BY checked_at NULLS FIRST,hash FOR UPDATE SKIP LOCKED LIMIT 12)
      RETURNING *`,[token])).rows
    let index=0
    await Promise.all(Array.from({length:Math.min(3,rows.length)},async()=>{while(index<rows.length){const row=rows[index++];try{const batch=(await db.query(`SELECT source,manifest FROM ${s}.refund_batches WHERE id=$1`,[row.batch_id])).rows[0];row.source=batch.source;row.afterBlock=batch.manifest.afterBlock;await processSubmission(row)}catch{await db.query(`UPDATE ${s}.refund_submissions SET error='Refund reconciliation is unavailable; evidence retained.',lease_token=NULL,lease_until=NULL,checked_at=NOW() WHERE hash=$1 AND lease_token=$2`,[row.hash,row.lease_token])}}}))
  }
  return {approve,prepare,detail,submit,remainder,poll,settle,executionEvidence,
    async list(){return {batches:(await db.query(`SELECT id,state,source,created_at FROM ${s}.refund_batches ORDER BY created_at DESC LIMIT 100`)).rows}},
    async forDeployment(id){const row=(await db.query(`SELECT o.* FROM ${s}.payment_obligations o JOIN ${s}.payment_proofs p ON p.hash=o.hash JOIN ${s}.deployment_intents i ON i.quote_id=p.quote_id WHERE i.id=$1`,[id])).rows[0];return row?.refund_reason?{hash:row.hash,reason:row.refund_reason,state:row.state,amountWei:row.amount_wei,verifiedWei:(await credit(row.hash)).toString()}:null},
  }
}
