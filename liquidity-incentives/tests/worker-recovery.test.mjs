import { it } from 'node:test'
import assert from 'node:assert/strict'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createCreator } from '../worker/creator.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'

async function setup(){
  const chain=await evmFixture(),store=await incentivesFixture(),db=store.database
  await store.seed(chain.account.address,10n**30n+'');await db.execution.heartbeat(chain.account.address)
  const service=createIncentivesService({database:db,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,origin:ORIGIN})
  return {chain,store,db,service,options:{database:db,rpc:chain.rpc,account:chain.account,config:chain.config},
    accept:async()=>store.accept(chain.account,await service.quote(chain.account.address,'cashcat-3d','100')),
    close:async()=>{await store.close();await chain.close()}}
}
it('every creation step resumes the same durable transaction after failure before broadcast', {timeout:120000},async()=>{
  const f=await setup()
  try{
    for(const stage of [1,2,3]){
      const id=(await f.accept()).id
      let attempt=0,fail=true
      const rpc=(method,params)=>{if(method==='eth_sendRawTransaction'&&++attempt===stage&&fail){fail=false;throw new Error('Interrupted before broadcast')}return f.chain.rpc(method,params)}
      assert.equal((await createCreator({...f.options,rpc}).tick()).state,'waiting')
      const saved=await f.db.execution.transactions(id)
      assert.equal(saved.length,stage)
      await f.db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW() WHERE intent_id=$1',[id])
      assert.equal((await createCreator({...f.options,rpc}).tick()).state,'created')
      const finished=await f.db.execution.transactions(id)
      assert.equal(finished.length,3)
      assert.equal(finished[stage-1].hash,saved[stage-1].hash)
    }
    assert.equal(f.chain.broadcasts,9)
  }finally{await f.close()}
})
it('operator proves same-nonce cancellation before resuming; altered saved terms cannot sign', {timeout:120000},async()=>{
  const f=await setup()
  try{
    const id=(await f.accept()).id
    let intercept=true
    const rpc=(method,params)=>{if(method==='eth_sendRawTransaction'&&intercept){intercept=false;throw new Error('Unbroadcast')}return f.chain.rpc(method,params)}
    assert.equal((await createCreator({...f.options,rpc}).tick()).state,'waiting')
    const saved=await f.db.execution.lastTransaction(id,'create-adapter')
    const hash=await f.chain.wallet.sendTransaction({to:f.chain.account.address,value:0n,nonce:Number(saved.nonce)})
    await f.chain.raw('evm_mine')
    await f.service.reconcileTransaction(id,f.chain.account.address,saved.hash,hash)
    const job=await f.db.getIntent(id)
    await f.db.execution.approveOperation(id,f.chain.account.address,job.plan_hash,'resume')
    assert.equal((await createCreator(f.options).tick()).state,'created')
    const transactions=await f.db.execution.transactions(id)
    assert.equal(transactions[0].resolution_kind,'cancelled')
    assert.equal(transactions[1].nonce,Number(saved.nonce)+1+'')
    assert.equal(f.chain.broadcasts,3)
    const next=(await f.accept()).id
    await f.db.query(`UPDATE saffron_incentives.deployment_intents SET snapshot=jsonb_set(snapshot,'{durationSeconds}','1') WHERE id=$1`,[next])
    const result=await createCreator(f.options).tick()
    assert.equal(result.state,'waiting');assert.equal((await f.db.execution.transactions(next)).length,0)
  }finally{await f.close()}
})
