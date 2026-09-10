import assert from 'node:assert/strict'
import { it } from 'node:test'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,program,ORIGIN } from './incentives-fixture.mjs'
import { deploymentTypedData } from '../shared/incentives.mjs'

const account=()=>privateKeyToAccount(generatePrivateKey())
it('concurrent programs share one budget; acceptance commits reservation and worker job atomically',async()=>{
  const fixture=await incentivesFixture(),a=account(),b=account()
  try{
    const db=fixture.database;await fixture.seed(a.address)
    await db.saveProgram({...program,id:'cashcat-90d',days:90},a.address)
    const quotes=await Promise.all([fixture.quote(a),fixture.quote(b,{programId:'cashcat-90d'})])
    const results=await Promise.allSettled([fixture.accept(a,quotes[0]),fixture.accept(b,quotes[1])])
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    assert.equal(results.find(r=>r.status==='rejected').reason.status,409)
    const audit=await db.auditBudget(program.budgetPoolId)
    assert.equal(audit.valid,true);assert.equal(audit.budget.reservedRaw,'60000');assert.equal(audit.budget.availableRaw,'40000')
    for(const table of ['deployment_intents','budget_reservations','vault_jobs']) assert.equal((await db.query(`SELECT count(*)::int AS n FROM saffron_incentives.${table}`)).rows[0].n,1)
    assert.equal((await db.query("SELECT count(*)::int AS n FROM information_schema.schemata WHERE schema_name IN ('liqifi','uniswap_v3_fiv')")).rows[0].n,0)
  }finally{await fixture.close()}
})
it('lost-response retries retain one commitment even after quote expiry; altered authorization fails',async()=>{
  let time=Date.now();const fixture=await incentivesFixture({now:()=>time}),a=account(),b=account()
  try{
    await fixture.seed(a.address);const q=await fixture.quote(a),first=await fixture.accept(a,q)
    time+=180_000
    const retries=await Promise.all(Array.from({length:6},()=>fixture.accept(a,q)))
    assert(retries.every(r=>r.id===first.id && r.replayed))
    const altered={...q,principalCents:'20000'}
    const signature=await a.signTypedData(deploymentTypedData(altered))
    await assert.rejects(fixture.database.acceptDeployment({wallet:a.address,quoteId:q.id,signature,origin:ORIGIN}),e=>e.status===401)
    await assert.rejects(fixture.accept(b,q),e=>e.status===404)
    assert.equal((await fixture.database.auditBudget(program.budgetPoolId)).budget.reservedRaw,'60000')
  }finally{await fixture.close()}
})
it('changed program, pair, and budget revisions invalidate unaccepted quotes',async()=>{
  const fixture=await incentivesFixture(),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address);const q=await fixture.quote(a)
    const p=(await db.catalog(true)).programs[0]
    await db.saveProgram({...p,active:false},a.address)
    await assert.rejects(fixture.accept(a,q),e=>e.status===409)
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.reservedRaw,'0')
    await db.saveProgram({...p,revision:p.revision+1,active:true},a.address)
    const q2=await fixture.quote(a),pair=(await db.catalog(true)).pairs[0]
    await db.savePair({...pair,active:false},a.address)
    await assert.rejects(fixture.accept(a,q2),e=>e.status===409)
    await db.savePair({...pair,revision:pair.revision+1,active:true},a.address)
    const q3=await fixture.quote(a),budget=(await db.catalog(true)).budgets[0]
    await db.saveBudget({...budget,paused:true},a.address)
    await assert.rejects(fixture.accept(a,q3),e=>e.status===409)
  }finally{await fixture.close()}
})
it('queue cancellation releases only unexecuted work and is idempotent',async()=>{
  const fixture=await incentivesFixture(),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address);const q=await fixture.quote(a),{id}=await fixture.accept(a,q)
    await db.query("UPDATE saffron_incentives.vault_jobs SET lease_owner='test',lease_until=NOW()+INTERVAL '1 minute' WHERE intent_id=$1",[id])
    assert.equal((await db.cancelDeployment(id,a.address)).needsReconciliation,true)
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.reservedRaw,'60000')
    await db.query('UPDATE saffron_incentives.vault_jobs SET lease_owner=NULL,lease_until=NULL WHERE intent_id=$1',[id])
    assert.equal((await db.cancelDeployment(id,a.address)).retired,true)
    assert.equal((await db.cancelDeployment(id,a.address)).retired,true)
    const audit=await db.auditBudget(program.budgetPoolId);assert.equal(audit.valid,true);assert.equal(audit.budget.availableRaw,'100000')
    assert.equal((await fixture.accept(a,q)).id,id,'retry cannot revive a retired intent')
  }finally{await fixture.close()}
})
it('partial/full funding moves reservations once; claim and maturity never replenish spending',async()=>{
  const fixture=await incentivesFixture(),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address);const q=await fixture.quote(a),{id}=await fixture.accept(a,q)
    await db.query("UPDATE saffron_incentives.vault_jobs SET plan=plan||jsonb_build_object('vault',$2::text) WHERE intent_id=$1",[id,a.address.toLowerCase()])
    const observed={verified:true,canonical:true,checkedAt:Date.now(),vault:a.address,variableCapacity:'60000',variableSupply:'20000',variableBalance:'20000',isStarted:false,blockHash:'0x'+'1'.repeat(64),blockNumber:'10'}
    await db.reconcileFunding(id,observed)
    await db.reconcileFunding(id,observed)
    let audit=await db.auditBudget(program.budgetPoolId)
    assert.equal(audit.budget.reservedRaw,'40000');assert.equal(audit.budget.allocatedRaw,'20000');assert.equal(audit.budget.availableRaw,'40000')
    await db.reconcileFunding(id,{...observed,variableSupply:'60000',variableBalance:'60000'})
    await db.reconcileFunding(id,{...observed,isStarted:true,variableSupply:'60000',variableBalance:'0'})
    await db.reconcileFunding(id,{...observed,isStarted:true,variableSupply:'0',variableBalance:'0'})
    audit=await db.auditBudget(program.budgetPoolId)
    assert.equal(audit.valid,true);assert.equal(audit.budget.allocatedRaw,'60000');assert.equal(audit.budget.availableRaw,'40000')
    const budget=(await db.catalog(true)).budgets[0]
    await assert.rejects(db.saveBudget({...budget,limitRaw:'59999'},a.address),e=>e.status===409)
  }finally{await fixture.close()}
})
it('pre-start funding withdrawal restores the reservation, and detected ledger drift closes admission',async()=>{
  const fixture=await incentivesFixture(),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address);const q=await fixture.quote(a),{id}=await fixture.accept(a,q)
    await db.query("UPDATE saffron_incentives.vault_jobs SET plan=plan||jsonb_build_object('vault',$2::text) WHERE intent_id=$1",[id,a.address.toLowerCase()])
    const observed={verified:true,canonical:true,checkedAt:Date.now(),vault:a.address,variableCapacity:'60000',variableSupply:'60000',variableBalance:'60000',isStarted:false}
    await db.reconcileFunding(id,observed);await db.reconcileFunding(id,{...observed,variableSupply:'0',variableBalance:'0'})
    const audit=await db.auditBudget(program.budgetPoolId)
    assert.equal(audit.valid,true);assert.equal(audit.budget.reservedRaw,'60000');assert.equal(audit.budget.availableRaw,'40000')
    await db.query('UPDATE saffron_incentives.budget_pools SET reserved_raw=reserved_raw+1 WHERE id=$1',[program.budgetPoolId])
    assert.equal((await db.auditBudget(program.budgetPoolId)).valid,false)
    await assert.rejects(fixture.quote(a,{premium:'1000'}),e=>e.status===409)
  }finally{await fixture.close()}
})
it('a failure to persist the worker job rolls back the entire acceptance',async()=>{
  const fixture=await incentivesFixture(),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address);const q=await fixture.quote(a)
    await db.query("CREATE FUNCTION saffron_incentives.fail_job() RETURNS trigger LANGUAGE plpgsql AS 'BEGIN RAISE EXCEPTION ''simulated unavailable queue''; END'; CREATE TRIGGER unavailable BEFORE INSERT ON saffron_incentives.vault_jobs FOR EACH ROW EXECUTE FUNCTION saffron_incentives.fail_job()")
    await assert.rejects(fixture.accept(a,q),/simulated unavailable queue/)
    assert.equal((await db.query('SELECT count(*)::int AS n FROM saffron_incentives.deployment_intents')).rows[0].n,0)
    const audit=await db.auditBudget(program.budgetPoolId)
    assert.equal(audit.valid,true);assert.equal(audit.budget.availableRaw,'100000')
    await db.query('DROP TRIGGER unavailable ON saffron_incentives.vault_jobs')
    assert.equal((await fixture.accept(a,q)).replayed,false)
  }finally{await fixture.close()}
})
it('expired quotes and per-wallet queue limits cannot create additional commitments',async()=>{
  let time=Date.now();const fixture=await incentivesFixture({now:()=>time,maxPendingPerWallet:1}),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address);const q=await fixture.quote(a,{premium:'1000'})
    time+=61_000;await assert.rejects(fixture.accept(a,q),e=>e.status===409)
    const fresh=await fixture.quote(a,{premium:'1000'});await fixture.accept(a,fresh)
    const extra=await fixture.quote(a,{premium:'1000'});await assert.rejects(fixture.accept(a,extra),e=>e.status===429)
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.reservedRaw,'1000')
  }finally{await fixture.close()}
})
