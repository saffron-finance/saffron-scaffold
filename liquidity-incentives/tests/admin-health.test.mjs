import { it } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionResult,keccak256 } from 'viem'
import { abi } from '../shared/vault-lifecycle.mjs'
import { createAdminHealth } from '../server/admin-health.mjs'

/** Explicit read fixtures cover partial outages without any host credentials,
 * database mutations, or signer. Browser tests use the actual local stack. */
function fixture(){
  const state={now:Date.now(),db:true,rpc:true,settings:true,heartbeat:null,cursor:null,mode:'automatic',enabled:true,contract:true,calls:0}
  const signer='0x'+'1'.repeat(40),code='0x6000',hash=keccak256(code)
  const config={factoryCodeHash:hash,vaultTypeHash:hash,adapterTypeHash:hash,vaultTypeId:1,adapterTypeId:2}
  const database={query:async(sql)=>{
    assert.match(sql,/^SELECT /,'health must only read');if(!state.db)throw new Error('postgres://user:password@private-host')
    return {rows:sql.includes('worker_heartbeats')?(state.heartbeat?[{updated_at:state.heartbeat}]:[]):sql.includes('payment_scan_cursors')?(state.cursor?[state.cursor]:[]):[]}
  },catalog:async()=>({budgets:[]})}
  const rpc=async(method)=>{
    if(!state.rpc)throw new Error('https://provider.invalid/secret-key')
    if(method==='eth_chainId')return '0x1237'
    if(method==='eth_getBlockByNumber')return {number:'0x100',hash:'0x'+'a'.repeat(64),timestamp:'0x'+Math.floor(state.now/1000).toString(16)}
    if(method==='eth_getCode')return state.contract?code:'0x6001'
    if(method==='eth_call')return encodeFunctionResult({abi,functionName:'vaultTypeByteCode',result:code})
    throw new Error('Unexpected method')
  }
  const service={readiness:async()=>{
    state.calls++;if(!state.db)throw new Error('private database exception')
    const online=state.heartbeat&&state.now-new Date(state.heartbeat).getTime()<15000
    return {canQuote:Boolean(state.enabled&&state.cursor&&(online||state.mode==='reviewed')),mode:state.mode,policy:{enabled:state.enabled,mode:state.mode,watcher_id:'native-eth-v1',expires_at:new Date(state.now+3600000),service_minutes:240},
      watcher:state.cursor?{blockNumber:'254',lagBlocks:'1',checkedAt:state.cursor.checked_at}:null,
      reasons:state.cursor?[]:['watcher_unavailable'],checks:{campaignFee:true,sizing:true,rpc:state.rpc},offerReady:{one:true}}
  }}
  const health=createAdminHealth({database,rpc,service,config,signer,feeRecipient:'0x'+'2'.repeat(40),now:()=>state.now,configuration:()=>{if(!state.settings)throw new Error('/private/config/path');return {settings:[]}}})
  return {state,health}
}
it('distinguishes enabled intake from missing worker/watcher and preserves manual launch checks',async()=>{
  const {health}=fixture(),result=await health(),check=id=>result.checks.find(c=>c.id===id)
  assert.equal(check('intake').state,'ready');assert.equal(result.canQuote,false)
  assert.equal(check('creator').state,'blocked');assert.match(check('creator').detail,/No heartbeat/)
  assert.equal(check('watcher').state,'blocked');assert.match(check('watcher').detail,/no recorded scan/)
  assert.equal(check('contracts').state,'ready');assert.equal(check('gas').state,'manual');assert.equal(check('premium').state,'manual')
  assert.ok(result.checks.every(c=>c.owner&&c.action&&c.detail))
})
it('keeps independent checks visible during database, RPC, and configuration failures; never leaks errors',async()=>{
  const {state,health}=fixture();state.db=false;state.settings=false
  let result=await health(),check=id=>result.checks.find(c=>c.id===id)
  assert.equal(result.canQuote,null);assert.equal(result.metrics,null)
  assert.equal(check('database').state,'unknown');assert.equal(check('configuration').state,'unknown')
  assert.equal(check('chain').state,'ready');assert.equal(check('creator').state,'unknown')
  assert.doesNotMatch(JSON.stringify(result),/password|private-host|provider.invalid|secret-key|\/private\/config/)
  state.db=true;state.settings=true;state.rpc=false;state.now+=6000;result=await health()
  assert.equal(check('database').state,'ready');assert.equal(check('chain').state,'unknown')
})
it('refreshes heartbeat/scan evidence, treats reviewed mode honestly, and coalesces polling',async()=>{
  const {state,health}=fixture();await Promise.all([health(),health(),health()]);assert.equal(state.calls,1)
  state.now+=6000;state.heartbeat=new Date(state.now);state.cursor={id:'native-eth-v1',block_number:'254',checked_at:new Date(state.now)}
  const online=await health();assert.equal(online.canQuote,true);assert.equal(online.checks.find(c=>c.id==='creator').state,'ready');assert.equal(online.checks.find(c=>c.id==='watcher').state,'ready')
  state.now+=6000;state.mode='reviewed';state.heartbeat=null
  const reviewed=await health();assert.equal(reviewed.canQuote,true);assert.equal(reviewed.checks.find(c=>c.id==='creator').state,'manual')
  state.now+=6000;state.contract=false
  assert.equal((await health()).checks.find(c=>c.id==='contracts').state,'blocked')
})
it('times out unavailable subsystems without hanging the whole report',async()=>{
  const health=createAdminHealth({database:{query:()=>new Promise(()=>{})},rpc:()=>new Promise(()=>{}),service:{readiness:()=>new Promise(()=>{})},configuration:()=>({settings:[]}),timeoutMs:10})
  const report=await health();assert.equal(report.canQuote,null);assert.equal(report.checks.find(c=>c.id==='database').state,'unknown')
})
