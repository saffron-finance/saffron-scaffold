import { it } from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount,generatePrivateKey } from 'viem/accounts'
import { incentivesFixture,pair } from './incentives-fixture.mjs'
import { proofHash } from '../shared/payment.mjs'

it('campaign holds and accepted requests share atomic USD/capacity limits; external funding consumes half and never refills on claim',async()=>{
  const f=await incentivesFixture({checkoutPolicy:{maxQuoteBps:5000,maxHeldBps:10000}}),db=f.database,a=privateKeyToAccount(generatePrivateKey()),b=privateKeyToAccount(generatePrivateKey())
  try{
    await db.savePair(pair,a.address)
    await db.saveCampaign({id:'three-day',name:'Three days',pairId:pair.id,days:3,budgetUsd:'10000',capacityUsd:'1000000',active:true},a.address)
    const quote=who=>f.quote(who,{programId:'three-day',principalCents:'50000000',premium:'500000'})
    const results=await Promise.allSettled([quote(a),quote(b),quote(a)])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,2)
    assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
    const qa=results[0].value??results[2].value,qb=results[1].value
    const accepted=await f.accept(a,qa)
    let accounting=(await db.catalog(true)).budgets[0].accounting
    assert.equal(accounting.reservedCapacityCents,'50000000');assert.equal(accounting.heldCapacityCents,'50000000');assert.equal(accounting.availableCapacityCents,'0')
    assert.equal((await f.accept(a,qa)).id,accepted.id)
    await db.query("UPDATE saffron_incentives.deployment_quotes SET expires_at=NOW()-INTERVAL '1 minute' WHERE id=$1",[(qb??results.find(r=>r.status==='fulfilled'&&r.value.id!==qa.id).value).id])
    await db.query("UPDATE saffron_incentives.vault_jobs SET plan=plan||jsonb_build_object('vault',$2::text) WHERE intent_id=$1",[accepted.id,a.address.toLowerCase()])
    const snapshot={verified:true,canonical:true,checkedAt:Date.now(),vault:a.address,variableCapacity:'500000',variableSupply:'500000',variableBalance:'500000',isStarted:false}
    await db.reconcileFunding(accepted.id,snapshot)
    accounting=(await db.catalog(true)).budgets[0].accounting
    assert.equal(accounting.fundedBudgetCents,'500000');assert.equal(accounting.availableBudgetCents,'500000')
    assert.equal(accounting.fundedCapacityCents,'50000000');assert.equal(accounting.availableCapacityCents,'50000000')
    assert.equal(accounting.fixedDepositedCents,'0','funding does not fabricate an LP deposit')
    await db.reconcileFunding(accepted.id,{...snapshot,isStarted:true,variableSupply:'0',variableBalance:'0'})
    assert.equal((await db.catalog(true)).budgets[0].accounting.fundedBudgetCents,'500000')
    const budget=(await db.catalog(true)).budgets[0]
    await assert.rejects(db.saveBudget({...budget,campaign:{...budget.campaign,inputs:{budgetUsd:'20000',capacityUsd:'1000000'}}},a.address),e=>e.status===409)
  }finally{await f.close()}
})

it('an unpaid hold can be released only by its private capability; pausing and resuming a new campaign works',async()=>{
  const f=await incentivesFixture({checkoutPolicy:{maxQuoteBps:5000,maxHeldBps:10000}}),db=f.database,a=privateKeyToAccount(generatePrivateKey())
  try{
    await db.savePair(pair,a.address)
    await db.saveCampaign({id:'paused',name:'Paused',pairId:pair.id,days:3,budgetUsd:'10000',capacityUsd:'1000000',active:false},a.address)
    let budget=(await db.catalog(true)).budgets[0]
    assert.equal((await db.offer('paused')).budget.paused,true)
    await db.saveBudget({...budget,paused:false},a.address)
    const secret='0x'+'4'.repeat(64),q=await f.quote(a,{programId:'paused',principalCents:'50000000',premium:'500000',recoveryHash:proofHash(secret)})
    await assert.rejects(db.withdrawQuote(q.id,'0x'+'5'.repeat(64)),e=>e.status===403)
    await db.withdrawQuote(q.id,secret)
    assert.equal((await db.catalog(true)).budgets[0].accounting.availableCapacityCents,'100000000')
    await assert.rejects(f.accept(a,q),e=>e.status===409,'withdrawn quote cannot create after its hold is released')
  }finally{await f.close()}
})
