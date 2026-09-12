/** Reset invariants with injected effects. These tests cannot call systemctl,
 * touch a real database, archive keys, or restart the user's test environment.
 */
import { readFile,writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { createResetController,isFresh,sessionId } from '../qa-reset.mjs'

const before={"environment": "Disposable local contracts; NOT mainnet", "commit": "8c912ee0c69f7db7c0fe4ba62bc5036486965647", "origin": "http://127.0.0.1:36859", "chainId": 4663, "user": "0x310A7029dA8Ea4846De91B581DF831d552Be9FFA", "treasury": "0x62CCEE49c74d264351e13eC4ec9B761F8b9e4EE0", "creator": "0xc3556175B5f5cE055bC0C1563b7ac73F7e1994b2", "busy": false, "jobs": [{"id": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "state": "created", "vault": "0x05ba59cd117a11232e9f9005d08c23a14397f106", "creation": {"state": "created", "simulationPassed": true, "upstreamBroadcasts": 0}, "funding": {"started": true, "suppliedRaw": "500000000000000250001", "capacityRaw": "500000000000000250001", "endTime": "1789413517"}}], "operations": [{"action": "create", "requestId": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "state": "created", "time": "2026-09-11T19:13:55.663Z"}, {"action": "fund", "requestId": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "amountRaw": "500000000000000250001", "transactions": [{"hash": "0x05afdf06e52c6f835c1c52a095c75317052a4ced0279cf94ba6649c3ab825267", "blockNumber": "9675", "blockHash": "0x8ccbdab389c14a02b6556d69eb668592e3af5b815b7425e8039f20f386322987"}, {"hash": "0x3a02f576e0f6772452b9197040979590e5ddb12c94cf95db4b21576d5c7db82e", "blockNumber": "9677", "blockHash": "0xea34139c9d029764734479d5ef2cf2bd108c5f80baec0ff96f85f3194f3df568"}], "time": "2026-09-11T19:18:22.641Z"}, {"action": "mature", "timestamp": 1789413519, "time": "2026-09-11T19:18:41.771Z"}, {"action": "mature", "timestamp": 1789413564, "time": "2026-09-11T19:19:25.405Z"}], "userTransactions": 7, "userMessageSignatures": 0, "creatorBroadcasts": 3, "clockAdvanced": true, "checkedAt": "2026-09-11T20:25:04.638Z"}
const fresh={...before,user:'0x1111111111111111111111111111111111111111',
  creator:'0x2222222222222222222222222222222222222222',treasury:'0x3333333333333333333333333333333333333333',
  origin:'http://127.0.0.1:41111',jobs:[],operations:[],clockAdvanced:false,userTransactions:0,userMessageSignatures:0,creatorBroadcasts:0}
const checks=[]

/** A controllable clock and process identity make timeout/replay cases instant. */
async function harness(options={}){
  let current=structuredClone(before),pid=100,clock=0,restarts=0,archives=0
  const records=[],effects=[]
  const deps={readStatus:async()=>structuredClone(current),readPid:async()=>pid,
    archive:async()=>{archives++;effects.push('archive');if(options.archiveFailure)throw Error('Disk full');return {verified:true}},
    restart:async()=>{restarts++;effects.push('restart');if(options.restartFailure)throw Error('Service failed');pid=200;if(!options.stale)current=structuredClone(fresh)},
    browserStatus:async()=>({available:true,open:!options.closed}),
    save:async record=>{records.push(structuredClone(record))},load:async()=>options.load??[],
    delay:async ms=>{clock+=ms},now:()=>clock,timeoutMs:3000}
  const controller=await createResetController(deps)
  return {controller,records,effects,deps,setCurrent:value=>{current=value},counts:()=>({restarts,archives})}
}

const normal=await harness()
const [first,duplicate]=await Promise.all([normal.controller.request(sessionId(before)),normal.controller.request(sessionId(before))])
assert.equal(first.id,duplicate.id)
await normal.controller.settle()
assert.equal(normal.controller.status().state,'ready')
assert.deepEqual(normal.counts(),{restarts:1,archives:1})
assert.deepEqual(normal.effects,['archive','restart'])
checks.push('Two simultaneous clicks share one archive and one restart, in that order')
const replay=await normal.controller.request(sessionId(before))
assert.equal(replay.id,first.id);assert.deepEqual(normal.counts(),{restarts:1,archives:1})
checks.push('Late retry from the old test does not reset the new test')

const failure=await harness({archiveFailure:true})
await failure.controller.request(sessionId(before));await failure.controller.settle()
assert.deepEqual(failure.counts(),{archives:1,restarts:0})
assert.equal(failure.controller.status().state,'failed')
assert.match(failure.controller.status().message,/not reset/)
checks.push('Archive failure preserves the old environment and reports failure')

for(const options of [{restartFailure:true},{stale:true},{closed:true}]){
  const test=await harness(options)
  await test.controller.request(sessionId(before));await test.controller.settle()
  assert.equal(test.controller.status().state,'failed')
  assert.equal(test.counts().restarts,1)
}
checks.push('Restart failure, stale identity, and missing browser never claim fresh readiness')

const invalid=await harness()
await assert.rejects(()=>invalid.controller.request('arbitrary-unit'),{status:400})
await assert.rejects(()=>invalid.controller.request(fresh.user),{status:409})
invalid.setCurrent({...before,busy:true})
await assert.rejects(()=>invalid.controller.request(sessionId(before)),{status:409})
assert.deepEqual(invalid.counts(),{archives:0,restarts:0})
checks.push('Invalid identities, stale clients, and active creation cannot start a reset')

assert.equal(isFresh(fresh,before,200,100),true)
for(const change of [{user:before.user},{creator:before.creator},{treasury:before.treasury},{clockAdvanced:true},
  {jobs:before.jobs},{operations:before.operations},{userTransactions:1},{creatorBroadcasts:1},{userMessageSignatures:1}]){
  assert.equal(isFresh({...fresh,...change},before,200,100),false)
}
assert.equal(isFresh(fresh,before,100,100),false)
checks.push('Readiness requires new process/wallets, no requests/actions, and an unadvanced clock')

const completedRecord=normal.records.at(-1)
const restored=await harness({load:[completedRecord]})
assert.equal((await restored.controller.request(sessionId(before))).id,first.id)
assert.deepEqual(restored.counts(),{archives:0,restarts:0})
checks.push('Persisted completed reset remains idempotent after a web-shell restart')
const interrupted=await harness({load:[{...completedRecord,state:'starting',finishedAt:null}]})
assert.equal(interrupted.controller.status().state,'failed')
assert.deepEqual(interrupted.counts(),{archives:0,restarts:0})
checks.push('Interrupted reset is visible and is never silently replayed at startup')

const result={checkedAt:new Date().toISOString(),checks,passed:checks.length,realRestarts:0}
console.log(JSON.stringify(result))
