import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,mockPayment } from './incentives-fixture.mjs'
import { createRefunds } from '../server/refunds.mjs'
const preparationRpc=async method=>{if(method==='eth_chainId')return '0x1237';if(method==='eth_blockNumber')return '0xf';throw new Error('Unexpected RPC '+method)}

test('external partial, combined and split payouts close once; reorgs preserve the execution stop',async()=>{
  const f=await incentivesFixture(),db=f.database,owner=privateKeyToAccount(generatePrivateKey()),source=privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
  try{
    await f.seed(owner.address)
    const qa=await f.quote(owner),qb=await f.quote(owner),a=await f.accept(owner,qa),b=await f.accept(owner,qb),ha=mockPayment(qa).hash,hb=mockPayment(qb).hash
    let proof={state:'verified',method:'direct-eth-v1',block:{number:'0x10',hash:'canonical'},payouts:[{index:0,recipient:owner.address.toLowerCase(),amountWei:'500'}]}
    const refunds=createRefunds({db,rpc:preparationRpc,verify:async()=>proof})
    for(const hash of [ha,hb]){
      const row=await db.paymentObligation(hash),resolution={operator:owner.address,revision:row.revision,requestKey:randomUUID(),reason:'Deployment cannot be fulfilled'}
      const first=await refunds.approve(hash,resolution,{category:'deployment_failed',fundingStopped:true})
      assert.deepEqual(await refunds.approve(hash,resolution,{category:'deployment_failed',fundingStopped:true}),first)
    }
    assert.equal(await db.execution.claim(owner.address,'worker'),null)
    await assert.rejects(f.accept(owner,qa),/being resolved/)
    const batch=await refunds.prepare({source,payments:[ha,hb],requestKey:randomUUID()},owner.address)
    assert.equal(batch.manifest.recipients.length,1);assert.equal(batch.manifest.recipients[0].amountWei,'2000')
    const first='0x'+'1'.repeat(64),second='0x'+'2'.repeat(64)
    await refunds.submit(batch.id,[first],owner.address);await refunds.poll()
    assert.equal((await refunds.detail(batch.id)).outstandingWei,'1500')
    assert.notEqual((await db.paymentObligation(ha)).state,'refunded')
    proof={...proof,payouts:[{index:1,recipient:owner.address.toLowerCase(),amountWei:'1500'},{index:2,recipient:source,amountWei:'9'}]}
    await refunds.submit(batch.id,[second,second],owner.address);await refunds.poll()
    assert.equal((await refunds.detail(batch.id)).outstandingWei,'0')
    assert.equal((await refunds.detail(batch.id)).unmatched.length,1)
    for(const hash of [ha,hb])assert.equal((await db.paymentObligation(hash)).state,'refunded')
    assert.equal(await db.execution.claim(owner.address,'worker'),null)
    await assert.rejects(db.execution.approveOperation(a.id,owner.address,qa.planHash,'resume'))
    assert((await db.auditBudget(qa.budgetPoolId)).valid)
    proof={state:'pending'}
    await db.query("UPDATE saffron_incentives.refund_submissions SET checked_at=NULL")
    await refunds.poll()
    for(const hash of [ha,hb]){const row=await db.paymentObligation(hash);assert.equal(row.state,'refund_exception');assert.equal(row.execution_allowed,false)}
    assert((await db.query("SELECT 1 FROM saffron_incentives.refund_verification_audit WHERE previous_evidence->>'state'='verified' AND evidence->>'state'='pending'")).rowCount>0)
    await assert.rejects(refunds.remainder(batch.id,owner.address),/uncertain/)
    assert.equal((await db.getIntent(b.id)).cancel_requested,true)
  }finally{await f.close()}
})

test('fresh remainder manifests cannot reuse a payout; returning reorg evidence becomes surplus',async()=>{
  const f=await incentivesFixture(),db=f.database,owner=privateKeyToAccount(generatePrivateKey()),source=privateKeyToAccount(generatePrivateKey()).address
  try{
    await f.seed(owner.address);const q=await f.quote(owner);await f.accept(owner,q);const hash=mockPayment(q).hash
    const first='0x'+'3'.repeat(64),second='0x'+'4'.repeat(64),proofs=new Map()
    const payout=amount=>({state:'verified',method:'direct-eth-v1',block:{number:'0x10',hash:'canonical'},payouts:[{index:0,recipient:owner.address.toLowerCase(),amountWei:amount}]})
    const refunds=createRefunds({db,rpc:preparationRpc,verify:async tx=>proofs.get(tx)})
    await refunds.approve(hash,{operator:owner.address,revision:(await db.paymentObligation(hash)).revision,requestKey:randomUUID(),reason:'Unfulfillable'}, {category:'deployment_failed',fundingStopped:true})
    const original=await refunds.prepare({source,payments:[hash],requestKey:randomUUID()},owner.address)
    proofs.set(first,payout('400'));await refunds.submit(original.id,[first],owner.address);await refunds.poll()
    await refunds.remainder(original.id,owner.address)
    const remaining=await refunds.prepare({source,payments:[hash],requestKey:randomUUID()},owner.address)
    assert.equal(remaining.manifest.items[0].amountWei,'600');assert.equal(remaining.manifest.afterBlock,'0xf')
    await assert.rejects(refunds.submit(remaining.id,[first],owner.address),/another refund batch/)
    // The first payout loses canonicality before the deliberate remainder lands.
    proofs.set(first,{state:'pending'});await db.query('UPDATE saffron_incentives.refund_submissions SET checked_at=NULL');await refunds.poll()
    proofs.set(second,payout('1000'));await refunds.submit(remaining.id,[second],owner.address);await refunds.poll()
    assert.equal((await db.paymentObligation(hash)).state,'refunded')
    proofs.set(first,payout('400'));await db.query('UPDATE saffron_incentives.refund_submissions SET checked_at=NULL WHERE hash=$1',[first]);await refunds.poll()
    assert.equal((await refunds.detail(original.id)).items[0].verifiedWei,'1000')
    assert.equal((await refunds.detail(original.id)).unmatched[0].amount_wei,'400')
    assert.equal((await refunds.detail(original.id)).outstandingWei,'0')
    assert.equal((await db.query("SELECT * FROM saffron_incentives.budget_entries WHERE event_key=$1",['refund-release:'+hash])).rowCount,1)
  }finally{await f.close()}
})

test('durable refund verification drains a large queue across bounded concurrent passes',async()=>{
  const f=await incentivesFixture(),db=f.database,owner=privateKeyToAccount(generatePrivateKey()),source=privateKeyToAccount(generatePrivateKey()).address
  try{
    await f.seed(owner.address);const q=await f.quote(owner);await f.accept(owner,q);const hash=mockPayment(q).hash,calls=new Map()
    const options={db,rpc:preparationRpc,verify:async tx=>{calls.set(tx,(calls.get(tx)??0)+1);return {state:'failed',block:{number:'0x10',hash:'canonical'}}}}
    const refunds=createRefunds(options)
    await refunds.approve(hash,{operator:owner.address,revision:(await db.paymentObligation(hash)).revision,requestKey:randomUUID(),reason:'Unfulfillable'}, {category:'deployment_failed',fundingStopped:true})
    const batch=await refunds.prepare({source,payments:[hash],requestKey:randomUUID()},owner.address)
    const hashes=Array.from({length:25},(_,i)=>'0x'+(i+100).toString(16).padStart(64,'0'))
    await refunds.submit(batch.id,hashes,owner.address)
    await Promise.all([refunds.poll(),createRefunds(options).poll()]);await createRefunds(options).poll()
    assert.equal(calls.size,25);assert([...calls.values()].every(count=>count===1))
    assert.equal((await refunds.detail(batch.id)).outstandingWei,'1000')
  }finally{await f.close()}
})

test('an execution lease and an unresolved signed nonce block preparation after approval',async()=>{
  const f=await incentivesFixture(),db=f.database,owner=privateKeyToAccount(generatePrivateKey()),source=privateKeyToAccount(generatePrivateKey()).address
  try{
    await f.seed(owner.address);const q=await f.quote(owner),accepted=await f.accept(owner,q),hash=mockPayment(q).hash
    const refunds=createRefunds({db,rpc:async()=>null})
    await db.execution.claim(owner.address,'worker')
    await refunds.approve(hash,{operator:owner.address,revision:(await db.paymentObligation(hash)).revision,requestKey:randomUUID(),reason:'Unable to deploy'}, {category:'deployment_failed',fundingStopped:true})
    await assert.rejects(refunds.prepare({source,payments:[hash],requestKey:randomUUID()},owner.address),/lease/)
    await db.query('UPDATE saffron_incentives.vault_jobs SET lease_until=NULL,lease_owner=NULL WHERE intent_id=$1',[accepted.id])
    await db.query("INSERT INTO saffron_incentives.chain_operations(intent_id,step,signer,nonce,resume_version,hash,raw_tx,transaction_data) VALUES($1,'create-adapter',$2,0,0,$3,'0x00','{}')",[accepted.id,owner.address,hash])
    await assert.rejects(refunds.prepare({source,payments:[hash],requestKey:randomUUID()},owner.address),/reconciliation/)
  }finally{await f.close()}
})
