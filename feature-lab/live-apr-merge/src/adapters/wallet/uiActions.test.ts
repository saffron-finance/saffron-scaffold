import { describe, expect, it } from 'vitest'
import { createClient, createPublicClient, createWalletClient, custom, parseAbi } from 'viem'
import { catalogReadActions, uiWalletActions, walletReadActions } from './uiActions'

const account='0x1111111111111111111111111111111111111111' as const
const hash=('0x'+'a'.repeat(64)) as `0x${string}`
const blockHash=('0x'+'b'.repeat(64)) as `0x${string}`
const chain={id:4663,name:'Fixture',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:['http://unused.invalid']}}}
const transaction={hash,blockHash,blockNumber:'0x10',transactionIndex:'0x0',from:account,to:account,gas:'0x5208',gasPrice:'0x1',input:'0x',nonce:'0x0',value:'0x1',type:'0x0',v:'0x1b',r:hash,s:hash}
const receipt={transactionHash:hash,blockHash,blockNumber:'0x10',transactionIndex:'0x0',from:account,to:account,contractAddress:null,cumulativeGasUsed:'0x5208',gasUsed:'0x5208',effectiveGasPrice:'0x1',logs:[],logsBloom:'0x',status:'0x1',type:'0x0'}

/** Independent transports let us compare the actual RPC payloads and results
 * against viem's full decorators. All replies are local; no wallet/network exists. */
function transport(rejectSend=false){
 const calls:unknown[]=[]
 return {calls,transport:custom({request:async request=>{
  calls.push(request)
  switch(request.method){
   case 'eth_accounts':case 'eth_requestAccounts':return [account]
   case 'eth_chainId':return '0x1237'
   case 'eth_blockNumber':return '0x11'
   case 'eth_getBalance':return '0x7b'
   case 'eth_getTransactionCount':return '0x2'
   case 'eth_estimateGas':return '0x5208'
   case 'eth_call':return '0x'+(123n).toString(16).padStart(64,'0')
   case 'eth_getTransactionByHash':return transaction
   case 'eth_getTransactionReceipt':return receipt
   case 'eth_getBlockByNumber':return {number:'0x10',hash:blockHash,timestamp:'0x100',transactions:[transaction],gasLimit:'0xffffff',gasUsed:'0x5208',difficulty:'0x0',size:'0x100'}
   case 'personal_sign':return '0x'+'1'.repeat(130)
   case 'wallet_addEthereumChain':case 'wallet_switchEthereumChain':return null
   case 'eth_sendTransaction':
    if(rejectSend)throw Object.assign(new Error('Rejected by fixture'),{code:4001})
    return hash
   default:throw new Error('Unexpected fixture RPC '+request.method)
  }
 }},{retryCount:0})}
}

describe('tree-shaken UI action compatibility with full viem clients',()=>{
 it('preserves typed contract reads, block/nonce/balance reads and receipt confirmation',async()=>{
  const a=transport(),b=transport()
  const full=createPublicClient({chain,transport:a.transport}),slim=createClient({key:'public',name:'Public Client',type:'publicClient',chain,transport:b.transport}).extend(catalogReadActions)
  const operations=[
   (c:typeof slim)=>c.readContract({address:account,abi:parseAbi(['function balanceOf(address) view returns (uint256)']),functionName:'balanceOf',args:[account]}),
   (c:typeof slim)=>c.getBalance({address:account}),
   (c:typeof slim)=>c.getBlockNumber({cacheTime:0}),
   (c:typeof slim)=>c.getTransactionCount({address:account,blockTag:'pending'}),
   (c:typeof slim)=>c.getTransaction({hash}),
   (c:typeof slim)=>c.getBlock({blockNumber:16n}),
   (c:typeof slim)=>c.waitForTransactionReceipt({hash,confirmations:2,timeout:1000}),
  ]
  for(const operation of operations)expect(await operation(slim)).toEqual(await operation(full))
  expect(b.calls).toEqual(a.calls)
  expect(slim.type).toBe(full.type)
 })
 it('preserves provider-bound gas estimation and silent reads',async()=>{
  const a=transport(),b=transport()
  const full=createPublicClient({chain,transport:a.transport}),slim=createClient({chain,transport:b.transport}).extend(walletReadActions)
  expect(await slim.estimateGas({account,to:account,value:1n})).toEqual(await full.estimateGas({account,to:account,value:1n}))
  expect(await slim.getTransactionCount({address:account,blockTag:'pending'})).toEqual(await full.getTransactionCount({address:account,blockTag:'pending'}))
  expect(await slim.getChainId()).toEqual(await full.getChainId())
  expect(b.calls).toEqual(a.calls)
 })
 it('preserves account prompts, message signing, chain switching and a single send',async()=>{
  const a=transport(),b=transport()
  const full=createWalletClient({transport:a.transport}),slim=createClient({key:'wallet',name:'Wallet Client',type:'walletClient',transport:b.transport}).extend(uiWalletActions)
  const operations=[
   (c:typeof slim)=>c.getAddresses(),(c:typeof slim)=>c.requestAddresses(),(c:typeof slim)=>c.getChainId(),
   (c:typeof slim)=>c.signMessage({account,message:'local equivalence test'}),
   (c:typeof slim)=>c.switchChain({id:4663}),(c:typeof slim)=>c.addChain({chain}),
   (c:typeof slim)=>c.sendTransaction({account,chain,to:account,value:1n}),
  ]
  for(const operation of operations)expect(await operation(slim)).toEqual(await operation(full))
  expect(b.calls).toEqual(a.calls)
  expect(b.calls.filter((r:any)=>r.method==='eth_sendTransaction')).toHaveLength(1)
 })
 it('never retries a rejected wallet send through the selected actions',async()=>{
  const fixture=transport(true),client=createClient({transport:fixture.transport}).extend(uiWalletActions)
  await expect(client.sendTransaction({account,chain,to:account,value:1n})).rejects.toThrow('Rejected by fixture')
  expect(fixture.calls.filter((r:any)=>r.method==='eth_sendTransaction')).toHaveLength(1)
 })
})
