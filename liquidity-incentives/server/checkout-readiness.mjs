import { creationFeeRecipient,quoteCreationFee } from './creation-fee.mjs'
import { WETH } from '../shared/vault-lifecycle.mjs'

/** Read-only qualification uses the same sizing and pricing paths as checkout.
 * Cache only bounded offer probes; intake/worker/watcher policy is always fresh. */
export function createCheckoutProbe({rpc,usdQuote,feeRecipient,signer,requireConfigured,size,now=Date.now}){
  const cache=new Map()
  return async(offers)=>{
    const checks={configuration:false,recipient:false,rpc:false,feeQuote:false,sizing:false},reasons=[],offerReady={}
    try{requireConfigured();checks.configuration=true}catch{reasons.push('deployment_unconfigured')}
    try{creationFeeRecipient(feeRecipient);checks.recipient=true}catch{reasons.push('fee_recipient_unconfigured')}
    if(checks.configuration)try{
      const [chain,latest,pending]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_getTransactionCount',[signer,'latest']),rpc('eth_getTransactionCount',[signer,'pending'])])
      if(BigInt(chain)!==4663n||!/^0x[0-9a-f]+$/i.test(latest)||!/^0x[0-9a-f]+$/i.test(pending)||BigInt(pending)<BigInt(latest))throw new Error('RPC state')
      checks.rpc=true
    }catch{reasons.push('checkout_rpc_unavailable')}
    if(checks.recipient)try{quoteCreationFee(feeRecipient,await usdQuote(WETH),now());checks.feeQuote=true}catch{reasons.push('fee_quote_unavailable')}
    const candidates=offers.filter(o=>o.active&&!o.budget.paused&&!o.budget.reconciliationRequired)
    if(checks.configuration&&checks.rpc&&checks.feeQuote){
      // Three concurrent plan reads bound upstream load without imposing a
      // limit on campaigns or paid requests.
      for(let start=0;start<candidates.length;start+=3)await Promise.all(candidates.slice(start,start+3).map(async offer=>{
        const key=JSON.stringify(offer),previous=cache.get(offer.id)
        if(previous?.key===key&&now()-previous.at<5000){offerReady[offer.id]=previous.ready;return}
        let ready=false
        try{await size(offer,'10000',signer);ready=true}catch{}
        cache.set(offer.id,{key,at:now(),ready});offerReady[offer.id]=ready
      }))
    }
    const ids=new Set(candidates.map(o=>o.id));for(const id of cache.keys())if(!ids.has(id))cache.delete(id)
    checks.sizing=Object.values(offerReady).some(Boolean)
    if(!checks.sizing)reasons.push(candidates.length?'program_sizing_unavailable':'no_available_programs')
    return {ready:Object.values(checks).every(Boolean),checks,reasons,offerReady,checkedAt:now()}
  }
}
