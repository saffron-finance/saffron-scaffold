import { decodeFunctionResult,encodeFunctionData,keccak256 } from 'viem'
import { abi,FACTORY,CHAIN_ID } from '../shared/vault-lifecycle.mjs'
import { validAddress } from '../shared/incentives.mjs'
import { operationalStatus } from './operational-status.mjs'

/** Bound each independent read and redact its failure. Never return a provider
 * exception, connection string, database error, or protected worker contents. */
async function probe(work,timeoutMs){
  let timer
  try{return {ok:true,value:await Promise.race([Promise.resolve().then(work),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error('Unavailable')),timeoutMs)})])}}
  catch{return {ok:false}}
  finally{clearTimeout(timer)}
}
const iso=value=>value?new Date(value).toISOString():null

/** Operator-only, read-only operational diagnostics. Failed subsystems do not
 * hide independent results. Cache and single-flight limit concurrent polling;
 * this endpoint never starts services, reads keys, or changes admission policy.
 */
export function createAdminHealth({database:db,rpc,service,configuration,config,signer,feeRecipient,now=Date.now,timeoutMs=6000,cacheMs=5000}){
  let cached,pending
  async function collect(){
    const checkedAt=iso(now()),checks=[]
    const add=(id,title,state,detail,owner,action,scope='checkout')=>checks.push({id,title,state,detail,owner,action,scope})
    add('api','Application API','ready','Your signed operator session reached the API.','Server operator','No action needed.')
    const [environment,database,chain,contracts,readiness,heartbeat]=await Promise.all([
      probe(()=>configuration(),timeoutMs),
      probe(()=>db.query('SELECT 1 AS connected'),timeoutMs),
      probe(async()=>{
        const [id,head]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_getBlockByNumber',['latest',false])])
        if(BigInt(id)!==BigInt(CHAIN_ID)||!head?.hash)throw new Error()
        const age=now()-Number(BigInt(head.timestamp))*1000
        return {block:BigInt(head.number).toString(),ageSeconds:Math.max(0,Math.floor(age/1000)),fresh:age>=-5000&&age<=60000}
      },timeoutMs),
      probe(async()=>{
        if(!config)throw new Error()
        const read=async(name,id)=>decodeFunctionResult({abi,functionName:name,data:await rpc('eth_call',[{to:FACTORY,data:encodeFunctionData({abi,functionName:name,args:[BigInt(id)]})},'latest'])})
        const code=await Promise.all([rpc('eth_getCode',[FACTORY,'latest']),read('vaultTypeByteCode',config.vaultTypeId),read('adapterTypeByteCode',config.adapterTypeId)])
        return code.every((value,index)=>value!=='0x'&&keccak256(value)===[config.factoryCodeHash,config.vaultTypeHash,config.adapterTypeHash][index])
      },timeoutMs),
      probe(()=>service.readiness(),timeoutMs),
      probe(async()=> (await db.query('SELECT updated_at FROM saffron_incentives.worker_heartbeats WHERE signer=$1',[signer?.toLowerCase()])).rows[0]?.updated_at??null,timeoutMs),
    ])
    const missing=environment.ok?environment.value.settings.filter(s=>['missing','invalid'].includes(s.status)):null
    add('configuration','Server settings',missing?(missing.length?'blocked':'ready'):'unknown',missing?(missing.length?missing.map(s=>s.name).join(', '):'Required settings and explicit connection options are valid.'):'Server configuration could not be verified.','Server operator','Review the configuration checklist below. Correct the named settings and restart the API.')
    add('database','Database',database.ok?'ready':'unknown',database.ok?'Database connection and application schema responded.':'The database could not be verified; no counts are assumed.','Server operator','Check PostgreSQL, the application database role, and PG connection settings.')
    add('chain','Robinhood RPC and chain head',chain.ok?(chain.value.fresh?'ready':'blocked'):'unknown',chain.ok?`Chain ${CHAIN_ID} · block ${chain.value.block} · head age ${chain.value.ageSeconds}s.`:'Robinhood chain identity and a fresh head could not be verified.','Server operator','Check the RPC endpoint, network access, chain ID 4663, and provider freshness.')
    add('contracts','Factory and registered contract types',contracts.ok?(contracts.value?'ready':'blocked'):'unknown',contracts.ok?(contracts.value?'Deployed bytecode matches the configured factory, vault type, and adapter type.':'Deployed code does not match the configured hashes.'):'Contract code checks could not complete.','Server operator','Verify the protocol file against the deployed factory and registered type IDs. Do not replace hashes just to clear a warning.')
    const ready=readiness.ok?readiness.value:null,policy=ready?.policy,mode=ready?.mode??null
    const heartbeatAt=heartbeat.ok?iso(heartbeat.value):null
    const online=heartbeat.ok&&heartbeatAt&&now()-Date.parse(heartbeatAt)<15000&&now()>=Date.parse(heartbeatAt)
    add('creator','Vault creator',heartbeat.ok?(online?'ready':mode==='reviewed'?'manual':'blocked'):'unknown',heartbeat.ok?(online?'The configured signer has a recent worker heartbeat. This is liveness evidence, not a successful signing test.':heartbeatAt?`Last heartbeat: ${heartbeatAt}.`:'No heartbeat has been recorded for the configured creator.'):'The creator heartbeat could not be checked.','Server operator',mode==='reviewed'?'Reviewed mode needs a separate request-pinned execution for each accepted payment; it does not require a continuous worker.':'Provision the dedicated creator credential and native ETH for gas. Start the creator service against this API database, using the same public signer. Inspect its service log if the heartbeat is stale.','execution')
    const watcherId=policy?.watcher_id??'native-eth-v1'
    const cursor=await probe(async()=> (await db.query('SELECT id,block_number,checked_at FROM saffron_incentives.payment_scan_cursors WHERE id=$1',[watcherId])).rows[0]??null,timeoutMs)
    const watcherReasons=ready?.reasons.filter(reason=>reason.startsWith('watcher_'))??[]
    const watcherOk=ready&&policy&&ready.watcher&&!watcherReasons.length
    add('watcher','ETH payment watcher',watcherOk?'ready':!cursor.ok?'unknown':'blocked',watcherOk?`Watcher ${watcherId} · block ${ready.watcher.blockNumber} · ${ready.watcher.lagBlocks} blocks behind. Last check: ${iso(ready.watcher.checkedAt)}.`:!cursor.ok?'The payment checkpoint could not be read.':!cursor.value?`Watcher ${watcherId} has no recorded scan.`:watcherReasons.includes('watcher_reconciliation_required')?'The recorded checkpoint does not match the canonical chain.':`Last check: ${iso(cursor.value.checked_at)??'never'}; scanning is stale, incomplete, or not yet verified for the intake policy.`,'Server operator','Start the keyless payment watcher with the same database and watcher ID as intake. Keep its reviewed start block and checkpoint. Check service logs for RPC or database errors; do not skip blocks to clear this warning.')
    add('intake','Request intake window',!ready?'unknown':policy?.enabled&&Date.parse(policy.expires_at)>now()?'ready':'blocked',!ready?'Intake policy could not be verified.':!policy?'No intake window is configured.':!policy.enabled?'The intake switch is paused.':Date.parse(policy.expires_at)<=now()?'The intake window has expired.':`Switch on · ${mode} mode · expires ${iso(policy.expires_at)}. Other blockers can still prevent payment.`,'You','After the server services are ready, use Administration → Edit intake window. Choose Automatic queue for continuous creation and set a staffed service window. Opening intake does not start either service.')
    add('campaigns','Active campaign and fixed ETH fee',!ready?'unknown':ready.checks.campaignFee?'ready':'blocked',!ready?'Campaign readiness could not be verified.':ready.checks.campaignFee?'At least one active, unpaused campaign has a valid fixed ETH request fee.':'No eligible campaign with a valid fixed ETH fee is available.','You','Create or resume a campaign in Campaigns. Select a verified pair, set a positive fixed ETH request fee, and resolve any reconciliation warning.')
    add('sizing','Pool, token prices, and quote sizing',!ready?'unknown':ready.checks.sizing?'ready':'blocked',!ready?'Read-only quote sizing could not be verified.':ready.checks.sizing?`${Object.values(ready.offerReady).filter(Boolean).length} campaign(s) passed the read-only sizing check. This checks pool metadata, fresh token prices, and protocol terms; it creates no quote or payment.`:'No campaign passed the read-only pool/price/sizing check.','Server operator','Check the token price service, pool metadata, and contract configuration. Token prices size LP deposits; they do not change the fixed ETH fee.')
    add('nonce','Creator nonce reads',!ready?'unknown':ready.checks.rpc?'ready':'blocked',ready?.checks.rpc?'Latest and pending creator nonces are readable on Robinhood. The worker still reconciles its journal before each transaction.':'Creator chain/nonce reads could not be verified.','Server operator','Use a dedicated creator wallet. Inspect its journal for pending or replaced transactions before retrying; never clear journal rows to reset a nonce.','execution')
    const operations=ready?await probe(()=>operationalStatus(db,ready,now),timeoutMs):{ok:false}
    const metrics=operations.ok?operations.value.metrics:null
    add('observations','Vault observations',!metrics?'unknown':metrics.staleVaultObservations?'warning':'ready',!metrics?'Vault observations could not be checked.':metrics.staleVaultObservations?`${metrics.staleVaultObservations} created vault(s) need a fresh observation.`:'No stale created-vault observations are recorded.','Server operator','Check the API observer and RPC connection. Funding and LP entry depend on canonical contract observations.','operations')
    add('payments','Payments and stalled requests',!metrics?'unknown':metrics.unresolvedPayments||metrics.oldestWithoutProgressSeconds>(policy?.service_minutes??240)*60?'warning':'ready',!metrics?'Payment and request counts could not be verified.':`${metrics.unresolvedPayments} unresolved payment(s); oldest undelivered request without progress: ${Math.floor(metrics.oldestWithoutProgressSeconds/60)} minutes.`,'You','Inspect the original request and transaction journal in Administration. Resolve exceptions there; do not ask the user to pay again.','operations')
    add('gas','Creator gas funding','manual','The worker checks its ability to pay before each signature. This page does not track wallet balances or gas spending.','You + server operator','Provide native ETH on Robinhood to the dedicated creator wallet. Verify its gas limits and service logs; an online heartbeat alone does not prove sufficient gas.','operations')
    add('premium','External premium funding','manual',metrics?`${metrics.fundingBacklog} vault(s) are waiting for premium funding. Funding ownership and future coverage are not automatically verified.`:'External funding coverage must be confirmed separately.','External funder','Assign a funder before accepting payments. After creation, fund each vault with its exact required premium; LP deposit stays blocked until full funding is observed.','operations')
    add('recovery','Backups and incident coverage','manual','Backups, restore readiness, refund payer, and staffed coverage are not verified by an API health check.','You + server operator','Confirm database backups and a restore drill, an external refund payer, and who handles stalled requests during the intake window.','operations')
    return {checkedAt,canQuote:ready?.canQuote??null,mode,checks,readiness:ready,metrics,configuration:environment.ok?environment.value:null,
      signer:validAddress(signer)?signer.toLowerCase():null,feeRecipient:validAddress(feeRecipient)?feeRecipient.toLowerCase():null,
      heartbeatAt,watcherId,watcherCheckedAt:cursor.ok?iso(cursor.value?.checked_at):null}
  }
  return ()=>{
    if(cached&&now()-cached.at<cacheMs)return Promise.resolve(cached.value)
    if(pending)return pending
    pending=collect().then(value=>{cached={at:now(),value};return value}).finally(()=>{pending=null})
    return pending
  }
}
