import { sameAddress } from '../shared/vault-lifecycle.mjs'

/** Apply immediately after restoring, with all signers stopped. A restore is
 * never an authorization to reuse a nonce, issue fees or release a commitment. */
export async function freezeRestoredDatabase(db,actor='restore-check'){
  await db.transaction(async client=>{
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('saffron-admission',0))")
    const policies=(await client.query('UPDATE saffron_incentives.intake_policies SET enabled=FALSE,revision=revision+1,updated_at=NOW() RETURNING *')).rows
    for(const policy of policies)await client.query('INSERT INTO saffron_incentives.intake_audit(signer,actor,policy) VALUES($1,$2,$3)',[policy.signer,actor,policy])
    const rows=(await client.query('UPDATE saffron_incentives.budget_pools SET paused=TRUE,reconciliation_required=TRUE,revision=revision+1 RETURNING id')).rows
    for(const row of rows)await db.entry(client,{budgetId:row.id,kind:'restore-frozen',actor,evidence:{intakePaused:true,requiresChainReconciliation:true}})
    await client.query('UPDATE saffron_incentives.worker_heartbeats SET updated_at=to_timestamp(0)')
    await client.query('UPDATE saffron_incentives.payment_scan_cursors SET checked_at=NULL')
  })
}

/** A read-only comparison of restored evidence with chain. A matching
 * nonce is necessary, not proof that an incomplete backup contains every quote.
 * This report never unpauses campaigns, intake or protected signer execution. */
export async function inspectRestoredDatabase({db,rpc,confirmations=2}){
  const problems=[],signers=[]
  if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw new Error('Restore verification requires the configured chain.')
  const head=await rpc('eth_getBlockByNumber',['latest',false])
  if(!head?.hash||Date.now()-Number(BigInt(head.timestamp))*1000>60000||Number(BigInt(head.timestamp))*1000>Date.now()+5000)throw new Error('Fresh restore evidence is required.')
  const canonical=async(number,hash)=>Boolean(hash&&BigInt(number)+BigInt(confirmations-1)<=BigInt(head.number)&&(await rpc('eth_getBlockByNumber',['0x'+BigInt(number).toString(16),false]))?.hash===hash)
  const journal=(await db.query('SELECT signer,nonce,hash,resolved_hash,receipt,transaction_data FROM saffron_incentives.chain_operations ORDER BY id')).rows
  const checkpoints=(await db.query("SELECT body->>'signer' signer,body->>'signerNonce' nonce FROM saffron_incentives.deployment_quotes")).rows
  for(const signer of new Set([...journal,...checkpoints].map(r=>r.signer))){
    const known=journal.filter(r=>r.signer===signer).map(r=>BigInt(r.nonce)+1n)
    known.push(...checkpoints.filter(r=>r.signer===signer&&r.nonce!==null).map(r=>BigInt(r.nonce)))
    const expected=known.length?known.reduce((a,b)=>a>b?a:b):null
    const latest=BigInt(await rpc('eth_getTransactionCount',[signer,'latest'])),pending=BigInt(await rpc('eth_getTransactionCount',[signer,'pending']))
    if(expected===null||latest!==expected||pending!==latest)problems.push({kind:'signer_nonce_requires_reconciliation',signer})
    signers.push({signer,expectedNonce:expected?.toString()??null,latestNonce:latest.toString(),pendingNonce:pending.toString()})
  }
  for(const saved of journal){
    const hash=saved.resolved_hash??saved.hash,receipt=await rpc('eth_getTransactionReceipt',[hash]),tx=await rpc('eth_getTransactionByHash',[hash])
    const exact=tx&&sameAddress(tx.from,saved.signer)&&BigInt(tx.nonce)===BigInt(saved.nonce)
      &&(sameAddress(tx.to,saved.transaction_data.to)&&tx.input===saved.transaction_data.data&&BigInt(tx.value)===BigInt(saved.transaction_data.value)
        ||sameAddress(tx.to,saved.signer)&&tx.input==='0x'&&BigInt(tx.value)===0n)
    if(!receipt||!exact||saved.receipt?.blockHash!==receipt.blockHash||!await canonical(receipt.blockNumber,receipt.blockHash))problems.push({kind:'transaction_requires_reconciliation',hash})
  }
  for(const {hash,evidence} of (await db.query('SELECT hash,evidence FROM saffron_incentives.payment_proofs')).rows)
    if(!evidence.blockNumber||!await canonical(evidence.blockNumber,evidence.blockHash))problems.push({kind:'payment_requires_reconciliation',hash})
  for(const cursor of (await db.query('SELECT id,block_number,block_hash FROM saffron_incentives.payment_scan_cursors')).rows)
    if(cursor.block_number!==null&&!await canonical(cursor.block_number,cursor.block_hash))problems.push({kind:'watcher_cursor_requires_reconciliation',id:cursor.id})
  for(const {intent_id,snapshot} of (await db.query('SELECT intent_id,snapshot FROM saffron_incentives.vault_observations')).rows)
    if(!snapshot.verified||!await canonical(snapshot.blockNumber,snapshot.blockHash))problems.push({kind:'vault_requires_reconciliation',id:intent_id})
  for(const budget of (await db.catalog(true)).budgets){
    const totals=(await db.query('SELECT COALESCE(sum(limit_delta),0)::text l,COALESCE(sum(reserved_delta),0)::text r,COALESCE(sum(allocated_delta),0)::text a FROM saffron_incentives.budget_entries WHERE budget_pool_id=$1',[budget.id])).rows[0]
    const reserves=(await db.query('SELECT COALESCE(sum(reserved_raw),0)::text r,COALESCE(sum(allocated_raw),0)::text a FROM saffron_incentives.budget_reservations WHERE budget_pool_id=$1',[budget.id])).rows[0]
    if(totals.l!==budget.limitRaw||totals.r!==budget.reservedRaw||totals.a!==budget.allocatedRaw||reserves.r!==totals.r||reserves.a!==totals.a)problems.push({kind:'budget_requires_reconciliation',id:budget.id})
  }
  if((await rpc('eth_getBlockByNumber',[head.number,false]))?.hash!==head.hash)throw new Error('Restore comparison block changed.')
  return {recordedEvidenceMatches:problems.length===0,signers,problems,activationAllowed:false,
    requiredReview:'Verify backup/WAL completeness, later quotes and fee receipts, protected signer permits. Reconcile before explicitly reopening campaigns and intake.'}
}
