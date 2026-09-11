import { it } from 'node:test'
import assert from 'node:assert/strict'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createCreator } from '../worker/creator.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { toHex } from 'viem'

async function setup(){
  const chain=await evmFixture(),store=await incentivesFixture(),db=store.database
  await store.seed(chain.account.address,10n**30n+'');await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
  const service=createIncentivesService({database:db,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
  return {chain,store,db,service,options:{database:db,rpc:chain.rpc,account:chain.account,config:chain.config},
    accept:async()=>chain.accept(service),
    close:async()=>{await store.close();await chain.close()}}
}
it('a base-fee-only quote survives a fee increase before each real local broadcast', {timeout:120000},async()=>{
  const f=await setup()
  try{
    const id=(await f.accept()).id
    let lastSuggested=0n,signatures=0
    const rpc=async(method,params)=>{
      if(method==='eth_gasPrice'){
        // Reproduce Robinhood's live quote: no margin above the current base.
        lastSuggested=BigInt((await f.chain.raw('eth_getBlockByNumber',['latest',false])).baseFeePerGas)
        assert.ok(lastSuggested>0n)
        return toHex(lastSuggested)
      }
      return f.chain.rpc(method,params)
    }
    const account={...f.chain.account,signTransaction:async tx=>{
      signatures++;assert.equal(tx.gasPrice,lastSuggested*2n)
      return f.chain.account.signTransaction(tx)
    }}
    // The old exact-quote policy fails admission here. Headroom must be present
    // in the first signed transaction; this test never signs a fee replacement.
    f.chain.beforeBroadcast=async()=>f.chain.raw('anvil_setNextBlockBaseFeePerGas',[toHex(lastSuggested*3n/2n)])
    assert.equal((await createCreator({...f.options,rpc,account}).tick()).state,'created')
    assert.equal(signatures,3);assert.equal(f.chain.broadcasts,3)
    assert.equal((await f.db.execution.transactions(id)).length,3)
  }finally{await f.close()}
})
it('a gas-quote RPC outage remains retryable and cannot sign or terminally fail a paid request', {timeout:120000},async()=>{
  const f=await setup()
  try{
    const id=(await f.accept()).id
    let signatures=0
    const account={...f.chain.account,signTransaction:async tx=>{signatures++;return f.chain.account.signTransaction(tx)}}
    const unavailable=(method,params)=>{if(method==='eth_gasPrice')throw new Error('Transient fee RPC outage');return f.chain.rpc(method,params)}
    const waiting=await createCreator({...f.options,account,rpc:unavailable}).tick()
    assert.equal(waiting.state,'waiting');assert.equal(signatures,0);assert.equal(f.chain.broadcasts,0)
    assert.equal((await f.db.execution.transactions(id)).length,0)
    await f.db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW() WHERE intent_id=$1',[id])
    assert.equal((await createCreator({...f.options,account}).tick()).state,'created')
    assert.equal(signatures,3);assert.equal(f.chain.broadcasts,3)
  }finally{await f.close()}
})
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
    assert.equal(result.state,'failed');assert.equal((await f.db.execution.transactions(next)).length,0)
  }finally{await f.close()}
})
