import { it } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { encodeFunctionData, decodeEventLog } from 'viem'
import { abi, FACTORY } from '../shared/vault-lifecycle.mjs'
import { canonicalReceipt, sendSaved } from '../ops/live-tests/2026-09-11-vault-2/operator-execution.mjs'

/** Public-only transaction fixture; deliberately invalid raw bytes can never be
 * broadcast to a real network. Every RPC below is an in-memory state machine. */
function fixture() {
  const signer='0x'+'1'.repeat(40),hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64)
  const data=encodeFunctionData({abi,functionName:'createAdapter',args:[2n,'0x'+'2'.repeat(40),'0x']})
  const tx={hash,nonce:0,raw_tx:'fixture-only-invalid-bytes',transaction_data:{to:FACTORY,data,value:'0',chainId:4663}}
  const receipt={transactionHash:hash,blockNumber:'0x10',blockHash,status:'0x1'}
  const mined={hash,from:signer,to:FACTORY,input:data,value:'0x0',nonce:'0x0',chainId:'0x1237',blockHash,blockNumber:'0x10'}
  const f={signer,tx,receipt,mined,visible:true,head:'0x11',sends:0,persists:0,nonceReads:0}
  f.rpc=async method=>{
    if(method==='eth_getTransactionReceipt')return f.visible?f.receipt:null
    if(method==='eth_getTransactionByHash')return f.mined
    if(method==='eth_getBlockByNumber')return {hash:blockHash}
    if(method==='eth_blockNumber')return f.head
    if(method==='eth_getTransactionCount'){f.nonceReads++;return '0x0'}
    if(method==='eth_sendRawTransaction'){f.sends++;return hash}
    throw new Error('Unexpected fixture RPC method')
  }
  f.options={tx,signer,confirmations:2,rpc:(...args)=>f.rpc(...args),persist:async()=>{f.persists++},timeoutMs:1000,pollMs:0}
  return f
}

it('a mined nonce waiting for its second confirmation is not treated as an unknown replacement',async()=>{
  const f=fixture(),base=f.rpc;let heads=0
  f.rpc=async(method,...args)=>method==='eth_blockNumber'?(++heads===1?'0x10':'0x11'):base(method,...args)
  assert.equal((await sendSaved(f.options)).status,'0x1')
  assert.equal(f.sends,0);assert.equal(f.nonceReads,0);assert.equal(f.persists,1)
})

it('lost send responses reconcile the saved hash with bytes persisted before the only send',async()=>{
  const f=fixture(),base=f.rpc;f.visible=false
  f.rpc=async(method,params)=>{
    if(method==='eth_sendRawTransaction'){
      assert.equal(f.persists,1);assert.equal(params[0],f.tx.raw_tx)
      f.sends++;f.visible=true;throw new Error('Injected response loss after acceptance')
    }
    return base(method,params)
  }
  assert.equal((await sendSaved(f.options)).transactionHash,f.tx.hash)
  assert.equal(f.sends,1);assert.equal(f.persists,2)
})

it('a consumed nonce without a receipt stops without sending or creating a replacement',async()=>{
  const f=fixture(),base=f.rpc;f.visible=false
  f.rpc=async(method,...args)=>method==='eth_getTransactionCount'?'0x1':base(method,...args)
  await assert.rejects(sendSaved(f.options),/Nonce consumed/)
  assert.equal(f.sends,0);assert.equal(f.persists,0)
})

it('a canonical revert is persisted as terminal and is never rebroadcast',async()=>{
  const f=fixture();f.receipt.status='0x0'
  await assert.rejects(sendSaved(f.options),/reverted/)
  assert.equal(f.tx.receipt.status,'0x0');assert.equal(f.persists,1);assert.equal(f.sends,0)
})

it('receipt reorgs and wrong-chain, nonce, sender or calldata evidence fail closed',async()=>{
  for(const change of [{chainId:'0x1'},{nonce:'0x1'},{from:'0x'+'9'.repeat(40)},{input:'0x'},{blockHash:'0x'+'c'.repeat(64)}]){
    const f=fixture();Object.assign(f.mined,change)
    await assert.rejects(canonicalReceipt(f.rpc,f.tx,f.signer,2),/does not match/)
    assert.equal(f.sends,0)
  }
  const f=fixture(),base=f.rpc
  f.rpc=async(method,...args)=>method==='eth_getBlockByNumber'?{hash:'0x'+'c'.repeat(64)}:base(method,...args)
  await assert.rejects(canonicalReceipt(f.rpc,f.tx,f.signer,2),/not canonical/)
})

it('a mismatched broadcast hash stops after one send without changing the saved transaction',async()=>{
  const f=fixture(),base=f.rpc;f.visible=false
  f.rpc=async(method,...args)=>{if(method==='eth_sendRawTransaction'){f.sends++;return '0x'+'c'.repeat(64)}return base(method,...args)}
  await assert.rejects(sendSaved(f.options),/different hash/)
  assert.equal(f.sends,1);assert.equal(f.tx.hash,'0x'+'a'.repeat(64))
})

it('the checked-in live record matches factory events, exact vault terms and gas accounting',async()=>{
  const root=new URL('../ops/live-tests/2026-09-11-vault-2/',import.meta.url)
  const result=JSON.parse(await readFile(new URL('live-result.json',root)))
  const verification=JSON.parse(await readFile(new URL('verification.json',root)))
  const simulation=JSON.parse(await readFile(new URL('simulation.json',root)))
  assert.equal(result.vault,'0x563008f7a958042429df7649f77a0c142fc36736')
  assert.equal(result.plan.premium,'499999999999999999727');assert.equal(result.observation.duration,259200)
  assert.equal(result.observation.initialized,true);assert.equal(result.observation.isStarted,false)
  assert.equal(result.observation.claimSupply,'0');assert.equal(result.observation.variableSupply,'0')
  assert.equal(verification.canonicalReceipts,3);assert.deepEqual(verification.completedReplay,{signatures:0,rpcCalls:0})
  assert.equal(simulation.simulationOnly,true);assert.equal(simulation.upstreamBroadcasts,0)
  assert.equal(simulation.observation.liquidity,result.observation.liquidity)
  let gas=0n
  for(const [index,tx] of result.transactions.entries()){
    assert.equal(tx.nonce,index);assert.equal(tx.receipt.status,'0x1');assert.equal(tx.receipt.transactionHash,tx.hash)
    assert.ok(!simulation.transactions.some(local=>local.hash===tx.hash),'fork hashes must not be reported as live')
    gas+=BigInt(tx.receipt.gasUsed)*BigInt(tx.receipt.effectiveGasPrice)
  }
  assert.equal(gas.toString(),result.gasPaidWei)
  const events=result.transactions.flatMap(tx=>tx.receipt.logs.filter(log=>log.address.toLowerCase()===FACTORY).flatMap(log=>{
    try{return [decodeEventLog({abi,data:log.data,topics:log.topics})]}catch{return []}
  }))
  const created=events.find(event=>event.eventName==='VaultCreated')
  assert.equal(created.args.vault.toLowerCase(),result.vault);assert.equal(created.args.vaultId,2n)
  const initialized=events.find(event=>event.eventName==='VaultInitialized')
  assert.equal(initialized.args.variableSideCapacity,499999999999999999727n)
  assert.equal(initialized.args.duration,259200n)
  assert.equal(initialized.args.fixedSideCapacity,BigInt(result.plan.liquidity))
})

it('public JSON evidence excludes signer credentials, authenticated endpoints and signed journals',async()=>{
  const root=new URL('../ops/live-tests/2026-09-11-vault-2/',import.meta.url)
  const names=['job.json','simulation.json','execution-test.json','live-result.json','verification.json','broadcast-recovery.json','vault-broadcast-recovery.json','provenance.json']
  const forbidden=/^(raw_tx|rawTransaction|privateKey|mnemonic|password|rpcUrl|rpcPassEntry|signerPassEntry|signerCredentialFile|database|telegramUser|telegramChat)$/i
  function inspect(value){
    if(Array.isArray(value))return value.forEach(inspect)
    if(value&&typeof value==='object')for(const [key,item]of Object.entries(value)){assert.ok(!forbidden.test(key),'private field '+key);inspect(item)}
    if(typeof value==='string')assert.ok(!/\/root\/|\.quiknode\.pro|https?:\/\/[^/\s]+@|-----BEGIN .*PRIVATE KEY/.test(value),'private endpoint/path/key marker')
  }
  for(const name of names)inspect(JSON.parse(await readFile(new URL(name,root))))
})
