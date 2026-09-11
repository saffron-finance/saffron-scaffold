import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { privateKeyToAccount,generatePrivateKey } from 'viem/accounts'
import { incentivesFixture,mockPayment,ORIGIN,program } from './incentives-fixture.mjs'

it('admission and refund operators race with one revision; retries are idempotent and a refund freezes creation',async()=>{
  const f=await incentivesFixture(),db=f.database,a=privateKeyToAccount(generatePrivateKey())
  try{
    await f.seed(a.address);const q=await f.quote(a),payment={...mockPayment(q),late:true}
    await assert.rejects(db.acceptDeployment({wallet:q.wallet,quoteId:q.id,payment,origin:ORIGIN}),e=>e.status===409)
    const row=await db.paymentObligation(payment.hash),resolution={operator:a.address.toLowerCase(),revision:row.revision,requestKey:randomUUID(),reason:'Reviewed the canonical received fee.'}
    const results=await Promise.allSettled([
      db.markRefundDue(payment.hash,resolution),
      db.acceptDeployment({wallet:q.wallet,quoteId:q.id,payment,origin:ORIGIN,resolution:{...resolution,requestKey:randomUUID()}}),
    ])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
    const obligation=await db.paymentObligation(payment.hash)
    if(obligation.state==='refund_due'){
      assert.deepEqual(await db.markRefundDue(payment.hash,resolution),results[0].value)
      await assert.rejects(f.accept(a,q),e=>e.status===409)
    }else{
      const id=results[1].value.id
      await db.markRefundDue(payment.hash,{...resolution,requestKey:randomUUID(),revision:obligation.revision})
      await db.execution.claim(a.address,'test')
      await assert.rejects(db.execution.authorizeStep(id,'test'),/Cancellation|resolution/)
    }
    assert.equal((await db.paymentObligation(payment.hash)).execution_allowed,false)
  }finally{await f.close()}
})

it('duplicate fee resolution leaves the original request and its premium reservation intact',async()=>{
  const f=await incentivesFixture(),db=f.database,a=privateKeyToAccount(generatePrivateKey())
  try{
    await f.seed(a.address);const q=await f.quote(a),accepted=await f.accept(a,q),duplicate={...mockPayment(q),hash:'0x'+'8'.repeat(64)}
    await assert.rejects(db.recordPayment(duplicate),e=>e.status===409)
    const row=await db.paymentObligation(duplicate.hash)
    assert.equal(row.kind,'duplicate-fee')
    const refund=await db.markRefundDue(row.hash,{operator:a.address.toLowerCase(),revision:row.revision,requestKey:randomUUID(),reason:'Return the duplicate creation fee.'})
    assert.equal(refund.retirementRequired,false)
    assert.equal((await db.getIntent(accepted.id)).cancel_requested,false)
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.reservedRaw,'60000')
    assert.equal((await db.listPayments({limit:1})).payments[0].hash,duplicate.hash)
  }finally{await f.close()}
})
