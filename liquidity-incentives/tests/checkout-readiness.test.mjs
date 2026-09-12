import {it} from 'node:test'
import assert from 'node:assert/strict'
import {createCheckoutProbe} from '../server/checkout-readiness.mjs'
const address='0x'+'1'.repeat(40),offers=[{id:'campaign',active:true,budget:{paused:false}}]
function probe(overrides={}){return createCheckoutProbe({feeRecipient:address,signer:address,requireConfigured:()=>{},
  rpc:async m=>m==='eth_chainId'?'0x1237':'0x0',usdQuote:async()=>({priceRaw:'2000000000000000000000',checkedAt:Date.now()}),size:async()=>({}),...overrides})}
it('an enabled intake is not checkout-ready without its recipient, RPC, protocol, prices and sizing',async()=>{
  assert.equal((await probe()(offers)).ready,true)
  for(const options of [{feeRecipient:''},{requireConfigured:()=>{throw Error()}},{rpc:async()=>{throw Error()}},
    {rpc:async()=> '0x1'},{usdQuote:async()=>({priceRaw:'1',checkedAt:1})},{size:async()=>{throw Error('private endpoint')}}]){
    const status=await probe(options)(offers);assert.equal(status.ready,false);assert.ok(status.reasons.length);assert.doesNotMatch(JSON.stringify(status),/private endpoint/)
  }
})
it('one broken campaign stays unavailable without preventing valid campaigns or caching intake policy',async()=>{
  const status=await probe({size:async o=>{if(o.id==='broken')throw Error()}})([...offers,{id:'broken',active:true,budget:{}}])
  assert.equal(status.ready,true);assert.equal(status.offerReady.campaign,true);assert.equal(status.offerReady.broken,false)
  assert.equal((await probe()([])).ready,false)
})
