import { it } from 'node:test'
import assert from 'node:assert/strict'
import { mkdir,readFile,rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { encodeFunctionData } from 'viem'
import { abi,FACTORY,CHAIN_ID } from '../shared/vault-lifecycle.mjs'
import { assertOneShotTransaction,runOneRequest } from '../worker/one-shot.mjs'
import { protectedRpc } from '../worker/protected-config.mjs'
import { simulateFactory } from '../worker/fork-simulate.mjs'
import { readVault } from '../shared/vault-reader.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { privateFilesFixture } from './private-files-fixture.mjs'

/** Pure signing-firewall probes cover each forbidden escape without loading a
 * private signer or connecting to any chain. Full integration follows below. */
function signingCase(){
  const signer='0x'+'1'.repeat(40),requestId='11111111-1111-4111-8111-111111111111',pool='0x'+'2'.repeat(40)
  const plan={adapterTypeId:'2',vaultTypeId:'1',liquidity:'500',premium:'100',feeBps:'1250',vaultId:'3',adapter:'0x'+'3'.repeat(40)}
  const job={intent_id:requestId,plan_hash:'plan',operation:'create',resume_version:0,signer,plan,snapshot:{poolAddress:pool,durationSeconds:259200,variableAssetAddress:signer}}
  return {permit:{requestId,planHash:'plan',signer,initialNonce:7,maxGasWei:'100000'},job,step:'create-adapter',journal:[],
    transaction:{chainId:CHAIN_ID,to:FACTORY,value:0n,nonce:7,gas:100n,gasPrice:10n,data:encodeFunctionData({abi,functionName:'createAdapter',args:[2n,pool,'0x']})}}
}

it('one-shot firewall rejects cross-request, replay, out-of-order, nonce, value, gas, type and calldata changes',()=>{
  assert.doesNotThrow(()=>assertOneShotTransaction(signingCase()))
  const attacks=[
    f=>f.job.intent_id='another-request',f=>f.job.plan_hash='changed',f=>f.job.operation='retire',f=>f.job.resume_version=1,
    f=>f.job.signer='0x'+'4'.repeat(40),f=>f.transaction.to=f.job.signer,f=>f.transaction.chainId=1,f=>f.transaction.value=1n,
    f=>f.transaction.nonce=8,f=>f.transaction.gas=10001n,f=>f.step='create-vault',
    f=>f.transaction.data=encodeFunctionData({abi,functionName:'createAdapter',args:[1n,f.job.snapshot.poolAddress,'0x']}),
    f=>f.transaction.data=encodeFunctionData({abi,functionName:'createAdapter',args:[2n,f.job.signer,'0x']}),
    f=>f.transaction.data=encodeFunctionData({abi,functionName:'createAdapter',args:[2n,f.job.snapshot.poolAddress,'0x1234']}),
    f=>f.transaction.data='0x',f=>f.journal=Array(3).fill({}),
    f=>f.journal=[{step:'create-adapter',resume_version:0,receipt:null}],
    f=>f.journal=[{step:'create-adapter',resume_version:0,receipt:{status:'0x0'}}],
  ]
  for(const attack of attacks){const f=signingCase();attack(f);assert.throws(()=>assertOneShotTransaction(f))}
})

it('read-only fork RPC rejects every signing/admin method before touching the network',async()=>{
  const rpc=await protectedRpc({rpcUrl:'http://127.0.0.1:1'})
  for(const method of ['eth_sendRawTransaction','eth_sendTransaction','personal_sign','eth_sign','anvil_impersonateAccount','evm_setAccountBalance','debug_traceTransaction'])await assert.rejects(rpc(method,[]),/not permitted/)
  await assert.rejects(protectedRpc({rpcUrl:'http://example.com'}),/HTTPS or loopback/)
})

it('one-shot runner follows exactly the pinned paid request, journals three real calls, and permanently refuses a second vault',{timeout:120000},async()=>{
  const chain=await evmFixture(),store=await incentivesFixture(),db=store.database,files=await privateFilesFixture('saffron-one-shot-'),{directory}=files
  try{
    await store.seed(chain.account.address,10n**30n+'');await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
    const service=createIncentivesService({database:db,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const first=(await chain.accept(service)).id,second=(await chain.accept(service)).id
    const selected=await db.getIntent(second),simulation=await simulateFactory({upstream:chain.raw,config:chain.config,job:selected})
    assert.equal(simulation.upstreamBroadcasts,0);assert.equal(simulation.transactions.length,3)
    const config={...chain.config,maxDailyGasWei:'1000000000000000000'}
    const options={database:db,rpc:chain.rpc,account:chain.account,config,requestId:second,simulation,directory,pollMs:5}
    await assert.rejects(runOneRequest({...options,simulation:{...simulation,ok:false}}),/passing simulation/)
    await mkdir(join(directory,'execution.lock'))
    await assert.rejects(runOneRequest(options),/EEXIST/)
    await rmdir(join(directory,'execution.lock'))
    const result=await runOneRequest(options)
    assert.equal(result.state,'created');assert.equal(result.requestId,second);assert.equal(result.observation.initialized,true)
    assert.equal(result.observation.variableSupply,'0','creator cannot fund premiums')
    assert.equal(result.observation.claimSupply,'0','creator cannot deposit a user LP')
    // Deployment verification is independent of user linkage. No requester
    // wallet is required in factory calldata or for the vault-state inspector.
    const anonymous=await db.getIntent(second)
    delete anonymous.wallet;delete anonymous.snapshot.submitterAddress
    const anonymousObservation=await readVault(anonymous,chain.rpc)
    assert.equal(anonymousObservation.positionWallet,'0x'+'0'.repeat(40))
    assert.equal(anonymousObservation.vault,result.vault)
    assert.equal(anonymousObservation.liquidity,result.observation.liquidity)
    assert.equal(anonymousObservation.variableCapacity,result.observation.variableCapacity)
    assert.equal(anonymousObservation.claimBalance,'0')
    assert.equal(chain.broadcasts,3);assert.equal((await db.getIntent(first)).state,'queued')
    assert.equal((await db.execution.transactions(first)).length,0)
    assert.deepEqual((await db.execution.transactions(second)).map(tx=>tx.step),['create-adapter','create-vault','initialize-vault'])
    assert.equal((await runOneRequest(options)).vault,result.vault);assert.equal(chain.broadcasts,3,'completed rerun cannot spend again')
    const firstJob=await db.getIntent(first)
    await assert.rejects(runOneRequest({...options,requestId:first,simulation:{...simulation,requestId:first,planHash:firstJob.plan_hash}}),/already bound/)
    assert.equal(chain.broadcasts,3)
    const state=JSON.parse(await readFile(join(directory,'state.json'),'utf8'))
    assert.equal(state.status,'completed');assert.equal(state.identity.requestId,second)
    assert.equal(JSON.stringify(state).includes('raw_tx'),false)
  }finally{await store.close();await chain.close();await files.close()}
})

it('one-shot restart reconciles a lost broadcast without signing or creating twice',{timeout:120000},async()=>{
  const chain=await evmFixture(),store=await incentivesFixture(),db=store.database,files=await privateFilesFixture('saffron-one-shot-recover-'),{directory}=files
  try{
    await store.seed(chain.account.address,10n**30n+'');await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
    const service=createIncentivesService({database:db,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const requestId=(await chain.accept(service)).id,job=await db.getIntent(requestId)
    const simulation=await simulateFactory({upstream:chain.raw,config:chain.config,job})
    let hideReceipt=false,signatures=0
    const account={...chain.account,signTransaction:async tx=>{signatures++;return chain.account.signTransaction(tx)}}
    const rpc=async(method,params)=>{
      if(method==='eth_sendRawTransaction'){await chain.rpc(method,params);hideReceipt=true;throw new Error('Lost send response')}
      if(method==='eth_getTransactionReceipt'&&hideReceipt)return null
      return chain.rpc(method,params)
    }
    const options={database:db,rpc,account,config:{...chain.config,maxDailyGasWei:'1000000000000000000'},requestId,simulation,directory,pollMs:5}
    await assert.rejects(runOneRequest({...options,onProgress:result=>{if(result.state==='waiting')throw new Error('Simulated process stop')}}),/Simulated process stop/)
    const saved=await db.execution.transactions(requestId)
    assert.equal(saved.length,1);assert.equal(signatures,1)
    await db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW() WHERE intent_id=$1',[requestId])
    const result=await runOneRequest({...options,rpc:chain.rpc})
    assert.equal(result.state,'created');assert.equal(signatures,3);assert.equal(chain.broadcasts,3)
    assert.equal(result.transactions[0].hash,saved[0].hash)
  }finally{await store.close();await chain.close();await files.close()}
})

it('a proven revert exhausts the one-shot attempt and rerun cannot spend another nonce',{timeout:120000},async()=>{
  const chain=await evmFixture(),store=await incentivesFixture(),db=store.database,files=await privateFilesFixture('saffron-one-shot-revert-'),{directory}=files
  try{
    await store.seed(chain.account.address,10n**30n+'');await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
    const service=createIncentivesService({database:db,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const requestId=(await chain.accept(service)).id,job=await db.getIntent(requestId)
    const simulation=await simulateFactory({upstream:chain.raw,config:chain.config,job})
    // Only the disposable chain is altered: force an onchain revert after the
    // real worker has simulated/signed, proving the terminal-attempt behavior.
    chain.beforeBroadcast=async()=>{await chain.raw('anvil_setCode',[FACTORY,'0x60006000fd'])}
    const options={database:db,rpc:chain.rpc,account:chain.account,config:{...chain.config,maxDailyGasWei:'1000000000000000000'},requestId,simulation,directory,pollMs:5}
    await assert.rejects(runOneRequest(options),/stopped without retrying/)
    assert.equal(chain.broadcasts,1)
    assert.equal((await db.execution.transactions(requestId)).length,1)
    await assert.rejects(runOneRequest(options),/new attempt is not authorized/)
    assert.equal(chain.broadcasts,1)
    assert.equal(JSON.parse(await readFile(join(directory,'state.json'),'utf8')).status,'failed')
  }finally{await store.close();await chain.close();await files.close()}
})
