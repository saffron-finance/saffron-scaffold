import assert from 'node:assert/strict'
import { it } from 'node:test'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,program,ORIGIN,mockPayment } from './incentives-fixture.mjs'
import { proofHash } from '../shared/payment.mjs'
import pg from 'pg'
import { once } from 'node:events'

const account=()=>privateKeyToAccount(generatePrivateKey())
it('bootstrap creates an empty standalone catalog without superseded signature or worker-funding columns',async()=>{
  const f=await incentivesFixture()
  try{
    assert.deepEqual(await f.database.catalog(true),{pairs:[],programs:[],budgets:[]})
    const columns=(await f.database.query("SELECT table_name,column_name FROM information_schema.columns WHERE table_schema='saffron_incentives'")).rows
    for(const name of ['signature','funding_state','funding_max_raw','funding_operator','funding_round'])assert.equal(columns.some(c=>c.column_name===name),false)
    assert.equal(columns.some(c=>c.table_name==='budget_reservations'&&c.column_name==='expires_at'),false)
    assert.equal(columns.some(c=>c.table_name==='deployment_quotes'&&c.column_name==='payment_commitment'),true)
  }finally{await f.close()}
})
it('a lost idle PostgreSQL connection reconnects without losing accepted intents',async()=>{
  const fixture=await incentivesFixture(),a=account()
  const control=new pg.Pool({...fixture.connection,database:'postgres',max:1})
  try{
    await fixture.seed(a.address)
    const accepted=await fixture.accept(a,await fixture.quote(a))
    const client=await fixture.database.pool.connect(),pid=(await client.query('SELECT pg_backend_pid() AS pid')).rows[0].pid
    client.release()
    const disconnected=once(fixture.database.pool,'error')
    // Terminate only this fixture's verified database connection, never another database.
    const result=await control.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND datname=$2',[pid,fixture.connection.database])
    assert.equal(result.rowCount,1);await disconnected
    assert.equal((await fixture.database.getIntent(accepted.id)).id,accepted.id)
    assert.equal((await fixture.database.auditBudget(program.budgetPoolId)).valid,true)
  }finally{await control.end();await fixture.close()}
})
it('concurrent programs accept commitments above the old raw target without losing atomic accounting',async()=>{
  const fixture=await incentivesFixture(),a=account(),b=account()
  try{
    const db=fixture.database;await fixture.seed(a.address)
    await db.saveProgram({...program,id:'cashcat-90d',days:90},a.address)
    const quotes=await Promise.all([fixture.quote(a),fixture.quote(b,{programId:'cashcat-90d'})])
    await Promise.all([fixture.accept(a,quotes[0]),fixture.accept(b,quotes[1])])
    const audit=await db.auditBudget(program.budgetPoolId)
    assert.equal(audit.valid,true);assert.equal(audit.budget.reservedRaw,'120000')
    for(const table of ['deployment_intents','budget_reservations','vault_jobs'])assert.equal((await db.query(`SELECT count(*)::int n FROM saffron_incentives.${table}`)).rows[0].n,2)
  }finally{await fixture.close()}
})
it('lost-response retries retain one commitment even after quote expiry; altered payment evidence fails',async()=>{
  let time=Date.now();const fixture=await incentivesFixture({now:()=>time}),a=account(),b=account()
  try{
    await fixture.seed(a.address);const q=await fixture.quote(a),first=await fixture.accept(a,q)
    time+=180_000
    const retries=await Promise.all(Array.from({length:6},()=>fixture.accept(a,q)))
    assert(retries.every(r=>r.id===first.id && r.replayed))
    const payment={...mockPayment(q),planHash:'0x'+'0'.repeat(64)}
    await assert.rejects(fixture.database.acceptDeployment({wallet:a.address,quoteId:q.id,payment,origin:ORIGIN}),e=>e.status===401)
    await assert.rejects(fixture.accept(b,q),e=>e.status===404)
    assert.equal((await fixture.database.auditBudget(program.budgetPoolId)).budget.reservedRaw,'60000')
  }finally{await fixture.close()}
})
it('explicit program, pair and budget pauses preserve blocked paid obligations',async()=>{
  const fixture=await incentivesFixture(),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address);const q=await fixture.quote(a,{premium:'1000'})
    const p=(await db.catalog(true)).programs[0]
    await db.saveProgram({...p,active:false},a.address)
    await assert.rejects(fixture.accept(a,q),e=>e.status===409)
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.reservedRaw,'0')
    await db.saveProgram({...p,revision:p.revision+1,active:true},a.address)
    const q2=await fixture.quote(a,{premium:'1000'}),pair=(await db.catalog(true)).pairs[0]
    await db.savePair({...pair,active:false},a.address)
    await assert.rejects(fixture.accept(a,q2),e=>e.status===409)
    await db.savePair({...pair,revision:pair.revision+1,active:true},a.address)
    const q3=await fixture.quote(a,{premium:'1000'}),budget=(await db.catalog(true)).budgets[0]
    await db.saveBudget({...budget,paused:true},a.address)
    await assert.rejects(fixture.accept(a,q3),e=>e.status===409)
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
    await db.saveBudget({...budget,limitRaw:'59999'},a.address)
    assert.equal((await db.auditBudget(program.budgetPoolId)).valid,true)
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
    assert.equal(audit.valid,true);assert.equal(audit.budget.availableRaw,'40000');assert.equal(audit.budget.heldRaw,'60000')
    await db.query('DROP TRIGGER unavailable ON saffron_incentives.vault_jobs')
    assert.equal((await fixture.accept(a,q)).replayed,false)
  }finally{await fixture.close()}
})
it('paid-before-deadline requests survive response delay; additional paid requests remain allowed',async()=>{
  let time=Date.now();const fixture=await incentivesFixture({now:()=>time,maxPendingPerWallet:1}),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address);const q=await fixture.quote(a,{premium:'1000'})
    time+=61_000;await fixture.accept(a,q)
    await fixture.accept(a,await fixture.quote(a,{premium:'1000'}))
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.reservedRaw,'2000')
  }finally{await fixture.close()}
})

it('paid commitments do not expire while a worker is interrupted',async()=>{
  const fixture=await incentivesFixture(),a=account()
  try{
    const db=fixture.database;await fixture.seed(a.address)
    const quote=await fixture.quote(a,{premium:'1000'}),{id}=await fixture.accept(a,quote)
    await db.execution.claim(a.address,'interrupted')
    await db.query("UPDATE saffron_incentives.deployment_intents SET created_at=NOW()-INTERVAL '1 day' WHERE id=$1",[id])
    await db.execution.authorizeStep(id,'interrupted')
    await db.query("UPDATE saffron_incentives.vault_jobs SET lease_until=NOW()-INTERVAL '1 minute' WHERE intent_id=$1",[id])
    assert.equal((await db.execution.claim(a.address,'restarted')).id,id)
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.reservedRaw,'1000')
    assert.equal((await fixture.accept(a,quote)).id,id)
  }finally{await fixture.close()}
})

it('one wallet can create more than 100 concurrent paid requests despite former configured limits',async()=>{
  const f=await incentivesFixture({maxPending:4,maxPendingPerWallet:1}),a=account()
  try{
    await f.seed(a.address,'1')
    const quotes=await Promise.all(Array.from({length:120},()=>f.quote(a,{premium:'1000'})))
    const accepted=await Promise.all(quotes.map(q=>f.accept(a,q)))
    assert.equal(new Set(accepted.map(x=>x.id)).size,120)
    assert.equal((await f.database.auditBudget(program.budgetPoolId)).budget.reservedRaw,'120000')
  }finally{await f.close()}
})

it('elapsed time cannot release a hold; wrong watermark fails and an orphaned release restores the obligation',async()=>{
  let time=Date.now();const f=await incentivesFixture({now:()=>time}),a=account(),db=f.database
  try{
    await f.seed(a.address);const q=await f.quote(a)
    time+=3600_000
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.heldRaw,'60000')
    await assert.rejects(db.settleCheckouts('missing',{number:'0x10',hash:'0x'+'a'.repeat(64),timestamp:'0x'+Math.ceil(time/1000).toString(16)}),e=>e.status===409)
    assert.equal((await f.settleCheckouts()).released,1)
    assert.equal((await db.auditBudget(program.budgetPoolId)).budget.heldRaw,'0')
    await db.reopenCheckoutSettlements('test-watermark')
    const audit=await db.auditBudget(program.budgetPoolId)
    assert.equal(audit.budget.heldRaw,'60000');assert.equal(audit.budget.reconciliationRequired,true)
    await assert.rejects(f.quote(a,{premium:'1000'}),e=>e.status===409)
    assert.equal((await db.quote(q.id)).paymentDeadline,q.paymentDeadline)
  }finally{await f.close()}
})

it('closing checkout and cosmetic edits preserve timely paid terms after the deadline',async()=>{
  let time=Date.now();const f=await incentivesFixture({now:()=>time}),a=account(),db=f.database
  try{
    await f.seed(a.address);const secret='0x'+'4'.repeat(64),q=await f.quote(a,{recoveryHash:proofHash(secret)})
    await db.withdrawQuote(q.id,secret)
    const p=(await db.catalog(true)).programs[0]
    await db.saveProgram({...p,sortOrder:5,isNew:false},a.address)
    time+=3600_000
    const accepted=await f.accept(a,q)
    assert.equal((await db.getIntent(accepted.id)).plan_hash,q.planHash)
    assert.equal((await f.settleCheckouts()).released,0)
  }finally{await f.close()}
})

it('deployment pages retain every entry beyond 100, including timestamp ties, while new inserts and wallet filters remain stable',async()=>{
  let time=Date.now()
  const fixture=await incentivesFixture({now:()=>time,maxPending:200,maxPendingPerWallet:200}),a=account(),b=account()
  try{
    const db=fixture.database;await fixture.seed(a.address)
    for(let i=0;i<101;i++){
      if(i===29)time=Date.now()+600_000
      await fixture.accept(a,await fixture.quote(a,{premium:'100'}))
    }
    await db.query("UPDATE saffron_incentives.deployment_intents SET created_at='2020-01-01T12:00:00.123456Z'")
    const expected=(await db.query('SELECT id FROM saffron_incentives.deployment_intents ORDER BY created_at DESC,id DESC')).rows.map(row=>row.id)
    const first=await db.list({wallet:a.address,limit:17}),ids=first.jobs.map(row=>row.id)
    assert.equal(ids.length,17)
    const newer=(await fixture.accept(a,await fixture.quote(a,{premium:'100'}))).id
    const foreign=(await fixture.accept(b,await fixture.quote(b,{premium:'100'}))).id
    let cursor=first.nextCursor
    while(cursor){const page=await db.list({wallet:a.address,limit:17,cursor});ids.push(...page.jobs.map(row=>row.id));cursor=page.nextCursor}
    assert.deepEqual(ids,expected);assert.equal(ids.includes(newer),false);assert.equal(ids.includes(foreign),false)
    assert.equal((await db.list({wallet:a.address})).jobs[0].id,newer)
    const all=[];cursor=null
    do{const page=await db.list({admin:true,limit:31,cursor});all.push(...page.jobs.map(row=>row.id));cursor=page.nextCursor}while(cursor)
    assert.equal(all.length,103);assert.equal(new Set(all).size,103);assert.ok(all.includes(foreign))
    assert.equal((await db.list({wallet:b.address,cursor:first.nextCursor})).jobs.length,0)
    for(const options of [{limit:0},{limit:101},{limit:'1; SELECT 1'},{cursor:'bad'},{cursor:'!'}])await assert.rejects(db.list({wallet:a.address,...options}),error=>error.status===400)
  }finally{await fixture.close()}
})
