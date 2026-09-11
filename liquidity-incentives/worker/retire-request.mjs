import { setTimeout as delay } from 'node:timers/promises'
import { keccak256 } from 'viem'
import { createCreator } from './creator.mjs'
import { sameAddress } from '../shared/vault-lifecycle.mjs'

/** Keyless bounded recovery: only this request's saved bytes can be broadcast.
 * There is no signing account, new attempt, or queue fallback in this runner. */
export async function runRetirement({database,rpc,config,requestId,planHash,timeoutMs=300000,pollMs=2000,onProgress=()=>{}}){
  const job=await database.getIntent(requestId)
  if(!job||job.plan_hash!==planHash||!sameAddress(job.signer,config.signerAddress)||job.operation!=='retire')throw new Error('An operator-approved retirement of the exact request and plan is required.')
  const replayRpc=async(method,params=[])=>{
    if(method==='eth_sendRawTransaction'){
      const hash=keccak256(params[0]),saved=(await database.execution.transactions(requestId)).find(tx=>tx.hash===hash&&tx.raw_tx===params[0])
      if(!saved)throw new Error('Retirement can only replay this request\'s saved transactions.')
    }
    return rpc(method,params)
  }
  const account={address:job.signer,signTransaction:async()=>{throw new Error('No retirement signing authority.')}}
  const worker=createCreator({database,rpc:replayRpc,account,config,requestId,retirementOnly:true})
  const deadline=Date.now()+timeoutMs
  while(Date.now()<deadline){
    const current=await database.getIntent(requestId)
    if(current.plan_hash!==planHash||current.operation!=='retire')throw new Error('Retirement scope changed.')
    if(current.state==='retired')return {requestId,state:'retired'}
    const result=await worker.tick();onProgress(result)
    if(result.state==='failed')throw new Error('Retirement needs external recovery or transaction reconciliation.')
    await delay(pollMs)
  }
  throw new Error('Retirement remains pending; its transaction journal is preserved.')
}
