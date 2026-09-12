import {it} from 'node:test'
import assert from 'node:assert/strict'
import {createCheckoutProbe} from '../server/checkout-readiness.mjs'
const address='0x'+'1'.repeat(40),offers=[{id:'campaign',active:true,requestFeeWei:'1000000000000000',budget:{paused:false}}]
function probe(overrides={}){return createCheckoutProbe({feeRecipient:address,signer:address,requireConfigured:()=>{},
  rpc:async m=>m==='eth_chainId'?'0x1237':'0x0',usdQuote:async()=>({priceRaw:'2000000000000000000000',checkedAt:Date.now()}),size:async()=>({}),...overrides})}
it('an enabled intake is not checkout-ready without its recipient, RPC, protocol and LP sizing',async()=>{
  assert.equal((await probe()(offers)).ready,true)
  for(const options of [{feeRecipient:''},{requireConfigured:()=>{throw Error()}},{rpc:async()=>{throw Error()}},
    {rpc:async()=> '0x1'},{size:async()=>{throw Error('private endpoint')}}]){
    const status=await probe(options)(offers);assert.equal(status.ready,false);assert.ok(status.reasons.length);assert.doesNotMatch(JSON.stringify(status),/private endpoint/)
  }
})
it('one broken campaign stays unavailable without preventing valid campaigns or caching intake policy',async()=>{
  const status=await probe({size:async o=>{if(o.id==='broken')throw Error()}})([...offers,{id:'broken',active:true,budget:{}}])
  assert.equal(status.ready,true);assert.equal(status.offerReady.campaign,true);assert.equal(status.offerReady.broken,false)
  assert.equal((await probe()([])).ready,false)
})

it('fixed campaign fees need no ETH price and unconfigured legacy offers cannot quote',async()=>{
  const run=probe({usdQuote:async()=>{throw Error('ETH oracle must not be used for fees')}})
  const status=await run([...offers,{id:'legacy',active:true,budget:{}}])
  assert.equal(status.ready,true);assert.equal(status.offerReady.legacy,false)
  assert.equal(status.checks.campaignFee,true)
  assert.equal((await run([{...offers[0],requestFeeWei:null}])).ready,false)
})
