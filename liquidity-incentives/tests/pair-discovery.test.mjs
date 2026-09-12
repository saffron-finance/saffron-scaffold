import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createPairDiscovery } from '../server/pair-discovery.mjs'
import { evmFixture,CASHCAT } from './evm-fixture.mjs'
import { WETH } from '../shared/vault-lifecycle.mjs'

it('token-list failure keeps canonical tokens; bounded lists deduplicate addresses and cache',async()=>{
  let count=0
  const failed=createPairDiscovery({fetchList:async()=>{count++;throw new Error('private upstream failure')}})
  const a=await failed.tokens(),b=await failed.tokens()
  assert.equal(a.source,'fallback');assert.equal(count,1);assert.deepEqual(a,b)
  assert(a.tokens.some(t=>t.symbol==='WETH'))
  const remote=createPairDiscovery({fetchList:async()=>new Response(JSON.stringify({tokens:[
    {chainId:4663,address:CASHCAT,symbol:'CAT',decimals:18,name:'Cash Cat'},
    {chainId:1,address:CASHCAT,symbol:'WRONG',decimals:18},
    {chainId:4663,address:WETH,symbol:'FAKE',decimals:6},
  ]}))})
  const list=await remote.tokens()
  assert.equal(list.source,'coingecko');assert.equal(list.tokens.filter(t=>t.address===CASHCAT).length,1)
  assert.equal(list.tokens.find(t=>t.address===WETH).symbol,'WETH')
  assert.equal(list.tokens.find(t=>t.address===WETH).decimals,18)
})

it('discovery uses real local ERC-20 metadata and Uniswap factory, preserves reward orientation and rejects invalid addresses',async()=>{
  const f=await evmFixture({realPositionManager:true})
  try{
    const discovery=createPairDiscovery({rpc:f.raw})
    assert.equal((await discovery.token(CASHCAT)).token.symbol,'CASHCAT')
    const result=await discovery.pools(CASHCAT,WETH)
    assert.equal(result.token0.decimals,18);assert.deepEqual(result.pools,[{pool:f.pool.toLowerCase(),feeTier:10000}])
    const reverse=await discovery.pools(WETH,CASHCAT)
    assert.equal(reverse.token0.symbol,'WETH');assert.deepEqual(reverse.pools,result.pools)
    await assert.rejects(discovery.pools(CASHCAT,CASHCAT),e=>e.status===400)
    await assert.rejects(discovery.token('https://foreign.example'),e=>e.status===400)
    await assert.rejects(discovery.token('0x'+'1'.repeat(40)),e=>e.status===400&&!e.message.includes('http'))
    const wrong=createPairDiscovery({rpc:async()=> '0x1'})
    await assert.rejects(wrong.token(CASHCAT),e=>e.status===503)
  }finally{await f.close()}
})
