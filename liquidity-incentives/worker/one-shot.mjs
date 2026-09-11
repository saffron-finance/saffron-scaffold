import { mkdir,readFile,open,rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { decodeFunctionData } from 'viem'
import { abi,CHAIN_ID,FACTORY,sameAddress } from '../shared/vault-lifecycle.mjs'
import { digest } from '../shared/incentives.mjs'
import { createCreator } from './creator.mjs'
import { readVault } from '../shared/vault-reader.mjs'
import { assertProtectedPath,ensurePrivateDirectory,replaceProtectedState } from './protected-files.mjs'

const steps=['create-adapter','create-vault','initialize-vault']

/** Last signing gate: exactly three sequential zero-value calls to the pinned
 * factory, matching this request's immutable plan and observed prior events.
 * Journals, not an in-memory counter, enforce the gas/nonce/attempt budget. */
export function assertOneShotTransaction({permit,job,step,transaction,journal}){
  if(job.intent_id!==permit.requestId||job.plan_hash!==permit.planHash||job.operation!=='create'||job.resume_version!==0)throw new Error('One-shot request or attempt mismatch.')
  if(!sameAddress(job.signer,permit.signer)||!sameAddress(transaction.to,FACTORY)||transaction.chainId!==CHAIN_ID||BigInt(transaction.value)!==0n)throw new Error('One-shot transaction scope mismatch.')
  if(journal.length>=3||step!==steps[journal.length]||journal.some((tx,index)=>tx.step!==steps[index]||Number(tx.resume_version)!==0||!tx.receipt||tx.receipt.status!=='0x1'))throw new Error('One-shot step limit or prior receipt check failed.')
  if(transaction.nonce!==permit.initialNonce+journal.length)throw new Error('One-shot nonce continuity failed.')
  const cost=journal.reduce((sum,tx)=>sum+BigInt(tx.transaction_data.gas)*BigInt(tx.transaction_data.gasPrice),0n)+transaction.gas*transaction.gasPrice
  if(cost>BigInt(permit.maxGasWei))throw new Error('One-shot total gas budget exceeded.')
  const plan=job.plan,t=job.snapshot,call=decodeFunctionData({abi,data:transaction.data})
  const expected=[['createAdapter',[BigInt(plan.adapterTypeId),t.poolAddress,'0x']],['createVault',[BigInt(plan.vaultTypeId),plan.adapter]],
    ['initializeVault',[BigInt(plan.vaultId??0),BigInt(plan.liquidity),BigInt(plan.premium),BigInt(t.durationSeconds),t.variableAssetAddress,BigInt(plan.feeBps)]]][journal.length]
  if(call.functionName!==expected[0]||call.args.length!==expected[1].length||call.args.some((value,index)=>String(value).toLowerCase()!==String(expected[1][index]).toLowerCase()))throw new Error('One-shot calldata differs from the reviewed plan.')
}

/** Persist a durable replacement. Public permit/results only; raw signed
 * bytes remain in the protected PostgreSQL execution journal, never this file. */
async function saveState(directory,state){
  const temp=join(directory,`state.${process.pid}.tmp`),file=await open(temp,'wx',0o600)
  try{await file.writeFile(JSON.stringify(state,null,2)+'\n');await file.sync()}finally{await file.close()}
  await replaceProtectedState(temp,join(directory,'state.json'))
}

/** One invocation follows only one reviewed request through canonical completion.
 * A private directory lock serializes the funded signer independently of the DB.
 * The permanent permit cannot be repointed after arming or completing. A crash
 * leaves the lock for deliberate inspection, never automatic lease-based reuse.
 * Local/fork callers inject disposable accounts/RPCs through the identical path. */
export async function runOneRequest({database,rpc,account,config,requestId,simulation,directory,onProgress=()=>{},timeoutMs=600000,pollMs=2000,now=Date.now}){
  if(!/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(requestId)||!Number.isFinite(timeoutMs)||timeoutMs<=0||!Number.isFinite(pollMs)||pollMs<0)throw new Error('Invalid one-shot arguments.')
  await ensurePrivateDirectory(directory)
  const lock=join(directory,'execution.lock');await mkdir(lock,{mode:0o700})
  try{
    await database.ready
    const job=await database.getIntent(requestId)
    if(!job||job.signer.toLowerCase()!==account.address.toLowerCase()||job.chain_id!==CHAIN_ID||!sameAddress(job.factory,FACTORY))throw new Error('Pinned deployment is unavailable or mismatched.')
    if(!simulation?.ok||simulation.simulationOnly!==true||simulation.upstreamBroadcasts!==0
      ||simulation.requestId!==requestId||simulation.planHash!==job.plan_hash||simulation.chainId!==CHAIN_ID||simulation.factoryCodeHash!==config.factoryCodeHash
      ||simulation.transactions?.length!==3||simulation.transactions.some((tx,index)=>tx.step!==steps[index]||tx.localOnly!==true)
      ||simulation.observation?.liquidity!==job.plan.liquidity||simulation.observation?.variableCapacity!==job.plan.premium
      ||simulation.observation?.duration!==Number(job.snapshot.durationSeconds))throw new Error('A passing simulation of this exact request is required.')
    const identity={requestId,signer:account.address.toLowerCase(),planHash:job.plan_hash,chainId:CHAIN_ID,factory:FACTORY,simulationHash:digest(simulation)}
    let state
    try{
      const file=join(directory,'state.json')
      await assertProtectedPath(file,{message:'Invalid one-shot state protection.'})
      state=JSON.parse(await readFile(file,'utf8'))
    }catch(error){if(error.code!=='ENOENT')throw error}
    if(state){
      if(digest(state.identity)!==digest(identity))throw new Error('This signer permit is already bound to another request or simulation.')
      if(state.status==='completed')return state.result
      if(state.status==='failed')throw new Error('The single attempt failed; a new attempt is not authorized.')
    }else{
      const simulatedAt=Date.parse(simulation.checkedAt)
      if(!Number.isFinite(simulatedAt)||now()-simulatedAt>600000||simulatedAt>now()+5000)throw new Error('A recent simulation is required before first signing.')
      const forkBlock=await rpc('eth_getBlockByNumber',['0x'+BigInt(simulation.forkBlockNumber).toString(16),false])
      if(forkBlock?.hash!==simulation.forkBlockHash)throw new Error('Simulation fork block is no longer canonical.')
      if(BigInt(simulation.worstCaseGasWei)>BigInt(config.maxDailyGasWei))throw new Error('Simulation exceeds the one-shot gas budget.')
      const transactions=await database.execution.transactions(requestId)
      if(transactions.length||job.state!=='queued'||job.resume_version!==0)throw new Error('A new one-shot permit requires an untouched queued request.')
      const [chain,latest,pending,balance]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_getTransactionCount',[account.address,'latest']),rpc('eth_getTransactionCount',[account.address,'pending']),rpc('eth_getBalance',[account.address,'latest'])])
      if(BigInt(chain)!==BigInt(CHAIN_ID)||BigInt(latest)!==BigInt(pending)||BigInt(latest)>BigInt(Number.MAX_SAFE_INTEGER))throw new Error('Signer chain/nonce is not ready for an isolated attempt.')
      if(!/^[1-9][0-9]*$/.test(String(config.maxDailyGasWei??''))||BigInt(balance)<BigInt(config.maxDailyGasWei))throw new Error('One-shot gas budget must be positive and covered by the funded signer.')
      state={identity,status:'armed',initialNonce:Number(BigInt(latest)),maxGasWei:String(config.maxDailyGasWei),armedAt:new Date(now()).toISOString()}
      await saveState(directory,state)
    }
    const permit={...identity,initialNonce:state.initialNonce,maxGasWei:state.maxGasWei}
    const worker=createCreator({database,rpc,account,config,requestId,beforeSign:async data=>assertOneShotTransaction({...data,permit,journal:await database.execution.transactions(requestId)})})
    const started=now()
    while(now()-started<timeoutMs){
      const outcome=await worker.tick();onProgress(outcome)
      const current=await database.getIntent(requestId)
      if(current.state==='created'){
        const observation=await readVault(current,rpc,{confirmations:config.confirmations})
        const transactions=await database.execution.transactionMetadata(requestId)
        if(transactions.length!==3||transactions.some((tx,index)=>tx.step!==steps[index]||Number(tx.resume_version)!==0||tx.receipt?.status!=='0x1'))throw new Error('Unexpected execution journal after creation.')
        const result={state:'created',requestId,chainId:CHAIN_ID,signer:account.address,vault:observation.vault,adapter:observation.adapter,observation,
          transactions:transactions.map(tx=>({step:tx.step,hash:tx.hash,nonce:tx.nonce,blockNumber:tx.receipt.blockNumber,blockHash:tx.receipt.blockHash,gasUsed:tx.receipt.gasUsed,effectiveGasPrice:tx.receipt.effectiveGasPrice}))}
        await saveState(directory,{...state,status:'completed',completedAt:new Date(now()).toISOString(),result});return result
      }
      if(outcome.state==='failed'||current.state==='failed'||current.state==='retired'){
        await saveState(directory,{...state,status:'failed',reason:outcome.reason??'Execution stopped'});throw new Error('One-shot attempt stopped without retrying.')
      }
      await delay(pollMs)
    }
    throw new Error('One-shot timed out; saved transactions retained for reconciliation, no new vault authorized.')
  }finally{await rmdir(lock)}
}
