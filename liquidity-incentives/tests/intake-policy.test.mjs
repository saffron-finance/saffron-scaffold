import { it } from 'node:test'
import assert from 'node:assert/strict'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { proofHash,paymentData } from '../shared/payment.mjs'
import { runRetirement } from '../worker/retire-request.mjs'
import { createCreator } from '../worker/creator.mjs'

it('reviewed intake boots with a keyless watcher and no signer heartbeat; stale, expired and full intake refuse quotes',{timeout:120000},async()=>{
  const chain=await evmFixture(),f=await incentivesFixture(),db=f.database
  const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
  const quote=()=>service.quote(chain.account.address,'cashcat-3d','100',proofHash(chain.recoverySecret))
  try{
    await f.seed(chain.account.address,10n**30n+'')
    await assert.rejects(quote(),/intake paused/)
    const watcher=await chain.prepareIntake(db)
    assert.equal((await service.readiness()).workerOnline,false)
    assert.equal((await service.readiness()).canQuote,true)
    const q=await quote()
    await chain.send(q.fee.recipient,paymentData(q),BigInt(q.fee.amountWei))
    assert.equal((await watcher.tick()).accepted,1)
    assert.equal(chain.broadcasts,0)
    assert.equal((await db.query('SELECT count(*)::int n FROM saffron_incentives.vault_jobs')).rows[0].n,1)
    await db.query("UPDATE saffron_incentives.payment_scan_cursors SET checked_at=NOW()-INTERVAL '1 minute'")
    await assert.rejects(quote(),/watcher unavailable/)
    await watcher.tick()
    await db.query("UPDATE saffron_incentives.intake_policies SET expires_at=NOW()-INTERVAL '1 second'")
    await assert.rejects(quote(),/intake expired/)
    await chain.prepareIntake(db)
    const policy=await db.intakePolicy(chain.account.address)
    await db.saveIntake({signer:chain.account.address,revision:policy.revision,mode:'reviewed',enabled:true,expiresAt:new Date(Date.now()+60000).toISOString(),serviceMinutes:60,maxPending:1,watcherId:'intake-fixture'},chain.account.address)
    await assert.rejects(quote(),/queue full/)
    assert.equal((await db.query('SELECT count(*)::int n FROM saffron_incentives.payment_proofs')).rows[0].n,1)
  }finally{await f.close();await chain.close()}
})

it('a pinned keyless retirement cannot create or claim another request and safely releases only its own saved work',{timeout:120000},async()=>{
  const chain=await evmFixture(),f=await incentivesFixture(),db=f.database
  try{
    await f.seed(chain.account.address,10n**30n+'');await chain.prepareIntake(db)
    const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const first=await chain.accept(service),second=await chain.accept(service),job=await db.getIntent(first.id),config={...chain.config,signerAddress:chain.account.address}
    await assert.rejects(runRetirement({database:db,rpc:chain.rpc,config,requestId:first.id,planHash:job.plan_hash}),/operator-approved/)
    const creator=createCreator({database:db,rpc:chain.rpc,account:chain.account,config:chain.config})
    // Complete creation of the first paid request; the second remains queued.
    await creator.tick()
    await db.execution.approveOperation(first.id,chain.account.address,job.plan_hash,'retire')
    const before=chain.broadcasts
    const result=await runRetirement({database:db,rpc:chain.rpc,config,requestId:first.id,planHash:job.plan_hash,pollMs:1})
    assert.equal(result.state,'retired');assert.equal(chain.broadcasts,before)
    assert.equal((await db.getIntent(second.id)).state,'queued')
    assert.equal((await db.execution.transactions(second.id)).length,0)
  }finally{await f.close();await chain.close()}
})
