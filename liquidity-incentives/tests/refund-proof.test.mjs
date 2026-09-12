import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { encodeFunctionData } from 'viem'
import { verifyRefund,refundCsv,BULKSENDER,bulkAbi } from '../server/refund-proof.mjs'
const qualified=JSON.parse(readFileSync(new URL('./fixtures/bulksender-qualified.json',import.meta.url)))
const source='0x1111111111111111111111111111111111111111',a='0x2222222222222222222222222222222222222222',b='0x3333333333333333333333333333333333333333',hash='0x'+'a'.repeat(64),blockHash='0x'+'b'.repeat(64)
function fixture(){
  const tx={hash,from:source,to:BULKSENDER.address,value:'0xc',input:encodeFunctionData({abi:bulkAbi,functionName:'bulksendEther',args:[[BULKSENDER.address,a,b],[10n,4n,6n],'0x'+'0'.repeat(64)]}),blockNumber:'0xa',blockHash}
  const receipt={transactionHash:hash,blockNumber:'0xa',blockHash,status:'0x1',logs:[]}
  const state={tx,receipt,chain:'0x1237',code:qualified.implementationCode,head:'0xb',canonical:blockHash,slot:'0x'+BULKSENDER.implementation.slice(2).padStart(64,'0')}
  const rpc=async(method,params)=>{
    if(/debug|trace|send|sign/i.test(method))throw new Error('Forbidden RPC')
    if(method==='eth_chainId')return state.chain
    if(method==='eth_blockNumber')return state.head
    if(method==='eth_getTransactionByHash')return tx
    if(method==='eth_getTransactionReceipt')return state.receipt
    if(method==='eth_getBlockByNumber')return {hash:state.canonical}
    if(method==='eth_getCode')return params[0]===BULKSENDER.address?qualified.proxyCode:state.code
    if(method==='eth_getStorageAt')return state.slot
    if(method==='eth_getLogs')return []
    throw new Error(method)
  };return {state,rpc,tx,receipt}
}
test('qualified atomic bulk payouts exclude metadata and use ordinary reads only',async()=>{
  const f=fixture(),proof=await verifyRefund(hash,source,f.rpc)
  assert.deepEqual(proof.payouts,[{index:1,recipient:a,amountWei:'4'},{index:2,recipient:b,amountWei:'6'}])
  assert.equal(proof.method,'bulksender-atomic-eth-v1')
  assert.equal((await verifyRefund(hash,source,f.rpc,{afterBlock:'0xa'})).state,'ineligible','a historical transfer cannot satisfy a newly prepared manifest')
  assert.equal(refundCsv([{wallet:a,amountWei:'1000000000000000001'}]),a+',1.000000000000000001\n')
})
test('wrong chain, wrapper, code, source, metadata, reorg and reverted batch do not settle',async()=>{
  for(const mutate of [f=>f.state.chain='0x1',f=>f.tx.to=a,f=>f.tx.from=b,f=>f.state.code='0x00',f=>f.state.canonical='other',f=>f.tx.value='0x1',f=>f.state.slot='0x'+'0'.repeat(64)]){
    const f=fixture();mutate(f);await assert.rejects(verifyRefund(hash,source,f.rpc))
  }
  const f=fixture();f.receipt.status='0x0';assert.equal((await verifyRefund(hash,source,f.rpc)).state,'failed')
  f.state.receipt=null;assert.equal((await verifyRefund(hash,source,f.rpc)).state,'pending')
})
