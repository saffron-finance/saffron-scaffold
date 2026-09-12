import { it } from 'node:test'
import assert from 'node:assert/strict'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { proofHash,paymentData } from '../shared/payment.mjs'
import { createCreator } from '../worker/creator.mjs'

it('reviewed intake boots with a keyless watcher and no signer heartbeat; stale and expired intake refuse quotes but queue counts do not',{timeout:120000},async()=>{
  const chain=await evmFixture(),f=await incentivesFixture(),db=f.database
  const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
  const quote=()=>service.quote(chain.account.address,'cashcat-3d','100',proofHash(chain.recoverySecret))
  try{
    await f.seed(chain.account.address,10n**30n+'')
    await assert.rejects(quote(),/intake paused/)
    const watcher=await chain.prepareIntake(db)
    assert.equal((await service.readiness()).workerOnline,false)
    assert.equal((await service.readiness()).canQuote,true)
    const unconfigured=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,origin:ORIGIN})
    const unavailable=await unconfigured.programs()
    assert.equal(unavailable.readiness.intakeReady,true)
    assert.equal(unavailable.readiness.canQuote,false)
    assert.equal(unavailable.readiness.checks.recipient,false)
    assert.ok(unavailable.offers.every(o=>o.availability))
    await assert.rejects(()=>unconfigured.quote(chain.account.address,'cashcat-3d','100',proofHash(chain.recoverySecret)),/recipient/)
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
    assert.ok((await quote()).id)
    assert.equal((await db.query('SELECT count(*)::int n FROM saffron_incentives.payment_proofs')).rows[0].n,1)
  }finally{await f.close();await chain.close()}
})
