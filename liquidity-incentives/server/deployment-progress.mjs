import { decodeEventLog } from 'viem'
import { abi,FACTORY,sameAddress,eligibility } from '../shared/vault-lifecycle.mjs'

/** Progress follows canonical evidence and can move back to checking on reorg.
 * The fourth milestone is external funding, not another factory transaction. */
export async function deploymentProgress({job,observation,journal,payment,policy,rpc,confirmations=2,now=Date.now}){
  const names=['Prepare adapter','Create vault','Initialize and verify','Fund premium and enable entry']
  const steps=['create-adapter','create-vault','initialize-vault'],stages=names.map((name,index)=>({id:index+1,name,state:'pending',hash:null,confirmedAt:null}))
  let unavailable=false,head=null
  const latest=steps.map(step=>journal.filter(t=>t.step===step).at(-1)),used=new Set()
  if(journal.length){try{head=BigInt(await rpc('eth_blockNumber',[]))}catch{unavailable=true}}
  for(let i=0;i<3;i++){
    const tx=latest[i],stage=stages[i]
    if(!tx)continue
    stage.hash=tx.resolved_hash??tx.hash
    if(!tx.receipt){stage.state='active';continue}
    let block
    try{block=await rpc('eth_getBlockByNumber',[tx.receipt.blockNumber,false])}catch{unavailable=true}
    if(!block?.hash||block.hash!==tx.receipt.blockHash||head===null||head<BigInt(tx.receipt.blockNumber)+BigInt(confirmations-1)){
      stage.state='checking';unavailable=true;continue
    }
    if(tx.receipt.status!=='0x1'||tx.resolution_kind==='cancelled'){stage.state='blocked';continue}
    let valid=false
    {
      const wanted=['AdapterCreated','VaultCreated','VaultInitialized'][i]
      const events=tx.receipt.logs.filter(log=>sameAddress(log.address,FACTORY)&&!log.removed).flatMap(log=>{try{const event=decodeEventLog({abi,data:log.data,topics:log.topics});return event.eventName===wanted?[event.args]:[]}catch{return []}})
      const event=events[0]
      valid=events.length===1&&sameAddress(event.creator,job.signer)&&(i===0
        ?sameAddress(event.pool,job.snapshot.poolAddress)&&String(event.adapterTypeId)===String(job.plan.adapterTypeId)&&sameAddress(event.adapter,job.plan.adapter)
        :i===1?sameAddress(event.adapter,job.plan.adapter)&&String(event.vaultTypeId)===String(job.plan.vaultTypeId)&&sameAddress(event.vault,job.plan.vault)
        :sameAddress(event.vault,job.plan.vault)&&sameAddress(event.adapter,job.plan.adapter)&&sameAddress(event.variableAsset,job.snapshot.variableAssetAddress)
          &&String(event.fixedSideCapacity)===job.plan.liquidity&&String(event.variableSideCapacity)===job.plan.premium&&String(event.duration)===String(job.snapshot.durationSeconds)&&String(event.feeBps)===String(job.plan.feeBps))
    }
    const fresh=observation?.verified&&eligibility(observation,now()).state!=='checking'
    if(i===2)valid=Boolean(valid&&fresh&&observation.initialized)
    stage.state=valid&&!used.has(stage.hash)&&(i===0||stages[i-1].state==='complete')?'complete':'checking'
    used.add(stage.hash)
    if(stage.state==='complete')stage.confirmedAt=new Date(Number(BigInt(block.timestamp))*1000).toISOString()
  }
  const fresh=observation?.verified&&eligibility(observation,now()).state!=='checking'
  if(latest[2]?.receipt?.status==='0x1'&&!fresh)unavailable=true
  const funded=fresh&&(observation.isStarted||BigInt(observation.variableSupply)===BigInt(observation.variableCapacity)&&BigInt(observation.variableBalance)>=BigInt(observation.variableCapacity))
  if(stages[2].state==='complete'&&funded){stages[3].state='complete';stages[3].confirmedAt=job.funding_observed_at?.toISOString()??new Date(observation.checkedAt).toISOString()}
  let reason=unavailable?'verification_unavailable':payment&&['refund_due','confirming','refunded','reconciliation_required'].includes(payment.state)?'payment_'+payment.state
    :job.state==='retired'?'retired':job.cancel_requested?'retirement_requested':job.state==='failed'?'operator_review':job.state==='queued'?'queued'
    :stages[2].state==='complete'&&!funded?'awaiting_funding':stages.every(s=>s.state==='complete')?'ready':'creating'
  const operatorAction=reason==='operator_review'||reason.startsWith('payment_')||reason==='retirement_requested'
  const first=stages.find(stage=>stage.state!=='complete')
  if(first&&first.state==='pending'&&reason!=='queued')first.state=operatorAction||reason==='retired'?'blocked':'active'
  const times=stages.map(s=>s.confirmedAt).filter(Boolean)
  return {version:1,reason,stages,activeStage:first?.id??null,requestedAt:job.created_at.toISOString(),acceptedAt:job.created_at.toISOString(),
    lastProgressAt:times.sort().at(-1)??job.created_at.toISOString(),checkedAt:new Date(now()).toISOString(),
    observedBlock:fresh?{number:observation.blockNumber,hash:observation.blockHash,checkedAt:new Date(observation.checkedAt).toISOString()}:null,
    verificationAvailable:!unavailable,operatorAction,paymentState:payment?.state??'admitted',serviceWindowMinutes:policy?.service_minutes??null}
}
