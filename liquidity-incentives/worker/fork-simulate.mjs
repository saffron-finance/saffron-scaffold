import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { decodeEventLog,encodeFunctionData,keccak256 } from 'viem'
import { anvilBinary } from '../tests/anvil.mjs'
import { READ_METHODS } from './protected-config.mjs'
import { abi,CHAIN_ID,FACTORY,sameAddress } from '../shared/vault-lifecycle.mjs'
import { readVault } from '../shared/vault-reader.mjs'
import { legacyGasPrice } from './gas-policy.mjs'

/** Fork only through a loopback read-only bridge. Provider credentials never
 * enter Anvil arguments, stdout, cache, or the returned evidence. The authorized
 * public EOA is impersonated ONLY in Anvil; its real private key is never loaded.
 * All three calls execute against the actual registered protocol bytecode. */
export async function simulateFactory({upstream,config,job}){
  if(Number(BigInt(await upstream('eth_chainId',[])))!==CHAIN_ID)throw new Error('Wrong upstream chain.')
  const block=await upstream('eth_getBlockByNumber',[job.plan.sizingBlock,false])
  if(!block?.hash||block.hash!==job.plan.sizingBlockHash)throw new Error('Sizing block is no longer canonical.')
  const code=await upstream('eth_getCode',[FACTORY,block.number])
  if(keccak256(code)!==config.factoryCodeHash)throw new Error('Factory bytecode mismatch.')
  const methods={},bridge=createServer(async(req,res)=>{
    try{
      if(req.method!=='POST')throw new Error()
      let data='';for await(const chunk of req){data+=chunk;if(data.length>65536)throw new Error()}
      const body=JSON.parse(data),batch=Array.isArray(body)?body:[body]
      if(!batch.length||batch.length>100||batch.some(v=>!READ_METHODS.has(v.method)||!Array.isArray(v.params??[])))throw new Error()
      const output=await Promise.all(batch.map(async v=>{
        methods[v.method]=(methods[v.method]??0)+1
        try{return {jsonrpc:'2.0',id:v.id,result:await upstream(v.method,v.params??[])}}
        catch{return {jsonrpc:'2.0',id:v.id,error:{code:-32000,message:'Fork read unavailable: '+v.method+' at '+JSON.stringify(v.params?.at(-1))}}}
      }))
      res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(Array.isArray(body)?output:output[0]))
    }catch{res.writeHead(403);res.end('Read-only fork bridge rejected request')}
  })
  bridge.listen(0,'127.0.0.1');await once(bridge,'listening')
  // Reserve an ephemeral local port without reusing any app's RPC service.
  const reservation=createServer();reservation.listen(0,'127.0.0.1');await once(reservation,'listening')
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve))
  let child
  try{
    child=spawn(anvilBinary(),['--host','127.0.0.1','--port',String(port),'--chain-id',String(CHAIN_ID),'--fork-url',`http://127.0.0.1:${bridge.address().port}`,
      '--fork-block-number',BigInt(block.number).toString(),'--no-storage-caching','--silent'],{stdio:'ignore'})
    let spawnError=false;child.on('error',()=>{spawnError=true})
    const rpc=async(method,params=[])=>{
      const response=await fetch(`http://127.0.0.1:${port}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(30000)})
      const body=await response.json()
      // These diagnostics come only from local Anvil; the bridge strips every
      // upstream provider error before it reaches this process.
      if(!response.ok||body.error)throw new Error('Local fork call failed: '+method+'; '+String(body.error?.message??'unavailable').replace(/https?:\/\/\S+/g,'[endpoint]').slice(0,500))
      return body.result
    }
    let ready=false
    for(let i=0;i<100;i++){
      if(spawnError||child.exitCode!==null)throw new Error('Local fork process failed to start.')
      try{ready=Number(BigInt(await rpc('eth_chainId')))===CHAIN_ID}catch{}
      if(ready)break;await delay(100)
    }
    if(!ready)throw new Error('Local fork did not become ready.')
    if(keccak256(await rpc('eth_getCode',[FACTORY,'latest']))!==config.factoryCodeHash)throw new Error('Fork did not load the real factory.')
    await rpc('anvil_impersonateAccount',[job.signer])
    if(Number(BigInt(block.timestamp))<Math.floor(Date.now()/1000))await rpc('evm_setNextBlockTimestamp',[Math.floor(Date.now()/1000)])
    const resultJob=structuredClone(job),plan=resultJob.plan,transactions=[]
    const send=async(step,name,args,eventName)=>{
      const data=encodeFunctionData({abi,functionName:name,args}),base={from:job.signer,to:FACTORY,data,value:'0x0'}
      let estimate
      try{estimate=BigInt(await rpc('eth_estimateGas',[base]))}catch(error){throw new Error(step+': '+error.message)}
      const gas=(estimate*120n+99n)/100n
      // Simulate the same new-signature gas policy as the live creator, so the
      // reported conservative budget includes base-fee headroom too.
      const feeHead=await rpc('eth_getBlockByNumber',['latest',false])
      const gasPrice=legacyGasPrice({suggested:await rpc('eth_gasPrice'),baseFee:feeHead.baseFeePerGas??'0x0',maximum:config.maxGasPriceWei})
      if(gas>BigInt(config.maxGasPerTx)||gasPrice>BigInt(config.maxGasPriceWei))throw new Error('Fork exceeds operator gas limit.')
      const hash=await rpc('eth_sendTransaction',[{...base,gas:'0x'+gas.toString(16),gasPrice:'0x'+gasPrice.toString(16)}])
      let receipt
      for(let i=0;i<100;i++){receipt=await rpc('eth_getTransactionReceipt',[hash]);if(receipt)break;await delay(100)}
      if(receipt?.status!=='0x1')throw new Error(step+': fork transaction '+(receipt?'reverted':'was not mined')+'.')
      await rpc('evm_mine')
      transactions.push({step,localOnly:true,hash,gasEstimate:estimate.toString(),gasLimit:gas.toString(),gasUsed:BigInt(receipt.gasUsed).toString(),gasPriceWei:gasPrice.toString(),data})
      if(!eventName)return receipt
      const events=receipt.logs.filter(log=>sameAddress(log.address,FACTORY)).flatMap(log=>{
        try{const event=decodeEventLog({abi,data:log.data,topics:log.topics});return event.eventName===eventName?[event.args]:[]}catch{return []}
      })
      if(events.length!==1||!sameAddress(events[0].creator,job.signer))throw new Error('Fork event creator mismatch.')
      return events[0]
    }
    const adapter=await send('create-adapter','createAdapter',[BigInt(plan.adapterTypeId),job.snapshot.poolAddress,'0x'],'AdapterCreated')
    if(!sameAddress(adapter.pool,job.snapshot.poolAddress)||adapter.adapterTypeId.toString()!==plan.adapterTypeId)throw new Error('Fork adapter terms mismatch.')
    plan.adapter=adapter.adapter.toLowerCase();plan.adapterId=adapter.id.toString();plan.adapterCodeHash=keccak256(await rpc('eth_getCode',[plan.adapter,'latest']))
    const vault=await send('create-vault','createVault',[BigInt(plan.vaultTypeId),plan.adapter],'VaultCreated')
    if(!sameAddress(vault.adapter,plan.adapter)||vault.vaultTypeId.toString()!==plan.vaultTypeId)throw new Error('Fork vault terms mismatch.')
    plan.vault=vault.vault.toLowerCase();plan.vaultId=vault.vaultId.toString();plan.vaultCodeHash=keccak256(await rpc('eth_getCode',[plan.vault,'latest']))
    await send('initialize-vault','initializeVault',[BigInt(plan.vaultId),BigInt(plan.liquidity),BigInt(plan.premium),BigInt(job.snapshot.durationSeconds),job.snapshot.variableAssetAddress,BigInt(plan.feeBps)])
    const observation=await readVault(resultJob,rpc,{confirmations:2})
    if(BigInt(observation.claimSupply)!==0n||BigInt(observation.variableSupply)!==0n||observation.isStarted)throw new Error('Unexpected funding or LP state in simulation.')
    return {ok:true,simulationOnly:true,method:'Anvil fork; real factory bytecode; local impersonation, no private signer',requestId:job.intent_id,
      planHash:job.plan_hash,chainId:CHAIN_ID,signer:job.signer,factory:FACTORY,factoryCodeHash:config.factoryCodeHash,
      forkBlockNumber:BigInt(block.number).toString(),forkBlockHash:block.hash,checkedAt:new Date().toISOString(),
      transactions,worstCaseGasWei:transactions.reduce((sum,tx)=>sum+BigInt(tx.gasLimit)*BigInt(tx.gasPriceWei),0n).toString(),
      observation,upstreamMethods:methods,upstreamBroadcasts:0}
  }finally{
    if(child&&child.exitCode===null){child.kill('SIGTERM');await once(child,'exit')}
    bridge.closeAllConnections();await new Promise(resolve=>bridge.close(resolve))
  }
}
