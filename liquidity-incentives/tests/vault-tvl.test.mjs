import test from 'node:test'
import assert from 'node:assert/strict'
import { principalUsd,createVaultTvl } from '../server/vault-tvl.mjs'
const a='0x1111111111111111111111111111111111111111',b='0x2222222222222222222222222222222222222222',now=()=>100000
const snapshot={verified:true,canonical:true,adapterLiquidity:'1000000000000000000',sqrtPrice:(1n<<96n).toString(),minTick:-100,maxTick:100,token0:{address:a,decimals:18},token1:{address:b,decimals:18},blockNumber:'9',blockHash:'canonical'}
const quote={priceRaw:'2000000000000000000',checkedAt:100000}
test('TVL follows deposited adapter liquidity through transfer, maturity and withdrawal',()=>{
  const value=principalUsd(snapshot,b,quote,now());assert(value>0n)
  assert.equal(principalUsd({...snapshot,isStarted:true,endTime:'0',claimBalance:'0',fixedBalance:'0',positionWallet:b},b,quote,now()),value)
  assert.equal(principalUsd({...snapshot,adapterLiquidity:'0'},b,quote,now()),0n)
  assert(principalUsd({...snapshot,adapterLiquidity:'500000000000000000'},b,quote,now())<value)
  assert.throws(()=>principalUsd(snapshot,b,{...quote,checkedAt:0},now()))
})
test('campaign aggregation shares a confirmed block and rejects a reorg or missing position',async()=>{
  let reorg=false,bad=false
  const rpc=async(method,params)=>method==='eth_chainId'?'0x1237':params[0]==='latest'?{number:'0xa',hash:'head',timestamp:'0x64'}:{hash:reorg?'orphan':'canonical'}
  const db={query:async()=>({rows:[{id:'one',program_id:'campaign'}]}),getIntent:async()=>({plan:{vault:a},snapshot:{token1:{address:b}}})}
  const metrics=createVaultTvl({db,rpc,usdQuote:async()=>quote,now,read:async()=>{if(bad)throw new Error('RPC failed');return snapshot}})
  const offers=[{id:'campaign'}]
  await metrics.refresh(offers);assert.equal(metrics.current(offers).campaign.status,'available')
  reorg=true;await metrics.refresh(offers,{force:true});assert.notEqual(metrics.current(offers).campaign.status,'available')
  reorg=false;bad=true;await metrics.refresh(offers,{force:true});assert.equal(metrics.current(offers).campaign.usdRaw,null)
})
