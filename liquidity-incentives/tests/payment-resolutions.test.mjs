import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { privateKeyToAccount,generatePrivateKey } from 'viem/accounts'
import { incentivesFixture,mockPayment,ORIGIN,program } from './incentives-fixture.mjs'

it('two operators cannot admit the same late payment twice; successful replay is idempotent',async()=>{
  const f=await incentivesFixture(),db=f.database,a=privateKeyToAccount(generatePrivateKey())
  try{
    await f.seed(a.address);const q=await f.quote(a),payment={...mockPayment(q),late:true}
    await assert.rejects(db.acceptDeployment({wallet:q.wallet,quoteId:q.id,payment,origin:ORIGIN}),e=>e.status===409)
    const row=await db.paymentObligation(payment.hash),resolution={operator:a.address.toLowerCase(),revision:row.revision,requestKey:randomUUID(),reason:'Reviewed canonical fee.'}
    const request={wallet:q.wallet,quoteId:q.id,payment,origin:ORIGIN,resolution}
    const results=await Promise.allSettled([db.acceptDeployment(request),db.acceptDeployment({...request,resolution:{...resolution,requestKey:randomUUID()}})])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    assert.equal((await db.list({admin:true})).jobs.length,1)
    if(results[0].status==='fulfilled')assert.deepEqual(await db.acceptDeployment(request),results[0].value)
  }finally{await f.close()}
})

it('duplicate fee resolution leaves the original request and its premium reservation intact',async()=>{
  const f=await incentivesFixture(),db=f.database,a=privateKeyToAccount(generatePrivateKey())
  try{
    await f.seed(a.address);const q=await f.quote(a),accepted=await f.accept(a,q),duplicate={...mockPayment(q),hash:'0x'+'8'.repeat(64)}
    await assert.rejects(db.recordPayment(duplicate),e=>e.status===409)
    const row=await db.paymentObligation(duplicate.hash)
    assert.equal(row.kind,'duplicate-fee')
    assert.equal((await db.getIntent(accepted.id)).cancel_requested,false)
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.reservedRaw,'60000')
    assert.equal((await db.listPayments({limit:1})).payments[0].hash,duplicate.hash)
  }finally{await f.close()}
})
