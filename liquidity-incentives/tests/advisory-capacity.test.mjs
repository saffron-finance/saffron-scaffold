import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,pair } from './incentives-fixture.mjs'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { campaignPremiumCents } from '../shared/campaign.mjs'

/** Exercise real PostgreSQL transactions, not a mocked capacity implementation. */
async function fixture(){
  const f=await incentivesFixture(),account=privateKeyToAccount(generatePrivateKey()),db=f.database
  await db.savePair(pair,account.address)
  await db.saveCampaign({id:'planning',name:'Planning',pairId:pair.id,days:3,budgetUsd:'10000',capacityUsd:'1000000',active:true},account.address)
  const service=createIncentivesService({database:db,signer:account.address})
  return {...f,db,account,service}
}

it('90% is a portfolio advisory, not a checkout stop; unpaid quotes consume no target',async()=>{
  const f=await fixture(),{db,account,service}=f
  try{
    const quote=principalCents=>f.quote(account,{programId:'planning',principalCents,premium:'1000'})
    const first=await quote('89999900')
    assert.equal((await service.capacityAdvisory()).campaigns[0].nearCapacity,false)
    await f.accept(account,first)
    assert.equal((await service.capacityAdvisory()).campaigns[0].nearCapacity,false)
    await f.accept(account,await quote('100'))
    assert.equal((await service.capacityAdvisory()).campaigns[0].nearCapacity,true)
    await f.accept(account,await quote('200000000'))
    assert.equal((await service.capacityAdvisory()).campaigns[0].overTarget,true)
    assert.equal((await db.auditBudget('planning')).valid,true)
    assert.equal((await db.list({wallet:account.address})).jobs.length,3)
  }finally{await f.close()}
})

it('a planning target remains editable without changing quoted rates or accepted terms',async()=>{
  const f=await fixture(),{db,account,service}=f
  try{
    const q=await f.quote(account,{programId:'planning',principalCents:'200000000'}),accepted=await f.accept(account,q)
    const budget=(await db.catalog(true)).budgets[0]
    await db.saveAdvisoryBudget(budget.id,{revision:budget.revision,budgetUsd:'50000'},account.address)
    assert.equal((await service.capacityAdvisory()).campaigns[0].nearCapacity,false)
    assert.equal((await db.getIntent(accepted.id)).plan_hash,q.planHash)
    const next=await f.quote(account,{programId:'planning',principalCents:q.principalCents})
    assert.deepEqual(next.snapshot.campaign,q.snapshot.campaign)
    assert.equal(campaignPremiumCents(next.snapshot.campaign,next.principalCents),'2000000')
    await assert.rejects(db.saveAdvisoryBudget(budget.id,{revision:budget.revision,budgetUsd:'1'},account.address),e=>e.status===409)
  }finally{await f.close()}
})

it('public offers and new quote snapshots omit private targets and inventory details',async()=>{
  const f=await fixture(),{service,account,db}=f
  try{
    // Readiness is independent of DTO privacy; no RPC is needed for this check.
    service.readiness=async()=>({canQuote:true,workerOnline:false})
    const publicData=await service.programs()
    assert.doesNotMatch(JSON.stringify(publicData),/budgetCents|capacityCents|accounting|limitRaw|availableRaw|maximumCents|treasury|gasBalance|eligibleMaximum/)
    const q=await f.quote(account,{programId:'planning'})
    assert.doesNotMatch(JSON.stringify(q.snapshot.campaign),/budgetCents|capacityCents|inputs/)
    assert.equal(campaignPremiumCents(q.snapshot.campaign,'10000'),'100')
    for(const name of ['gas_reservations','treasury_allocations','refund_transfers','checkout_reviews']){
      assert.equal((await db.query('SELECT to_regclass($1) AS relation',['saffron_incentives.'+name])).rows[0].relation,null)
    }
    for(const name of ['cancelDeployment','markRefundDue','assignTreasury','checkJobGas','requestCheckoutReview'])assert.equal(db[name],undefined)
  }finally{await f.close()}
})

it('the non-destructive upgrade removes the old SQL cap and preserves accepted records',async()=>{
  const f=await incentivesFixture(),a=privateKeyToAccount(generatePrivateKey());let reopened
  try{
    await f.seed(a.address,'100000')
    const q=await f.quote(a),first=await f.accept(a,q)
    await f.database.query('ALTER TABLE saffron_incentives.budget_pools ADD CONSTRAINT legacy_hard_limit CHECK(reserved_raw+allocated_raw<=limit_raw)')
    await f.database.close()
    reopened=createIncentivesDatabase({connection:f.connection});await reopened.ready
    assert.equal((await reopened.getIntent(first.id)).plan_hash,q.planHash)
    await reopened.query('UPDATE saffron_incentives.budget_pools SET limit_raw=1')
    assert.equal((await reopened.auditBudget('cashcat-campaign')).budget.reservedRaw,'60000')
  }finally{await reopened?.close();await f.close()}
})

it('multiple unpaid checkouts from one browser retain independent idempotency keys',async()=>{
  const f=await fixture(),{db,account}=f
  try{
    const clientHash='1'.repeat(64)
    await db.query("INSERT INTO saffron_incentives.checkout_clients(id,peer_hash,expires_at) VALUES($1,'fixture',NOW()+INTERVAL '1 day')",[clientHash])
    const options={programId:'planning',clientHash,requestKey:randomUUID()}
    const results=await Promise.all([f.quote(account,options),f.quote(account,options),f.quote(account,{...options,requestKey:randomUUID()})])
    assert.equal(results[0].id,results[1].id);assert.notEqual(results[0].id,results[2].id)
    assert.equal((await db.query('SELECT count(*)::int n FROM saffron_incentives.deployment_quotes')).rows[0].n,2)
  }finally{await f.close()}
})
