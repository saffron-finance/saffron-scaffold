import { decodeFunctionData, encodeFunctionData, keccak256, parseAbi, stringToHex } from 'viem'
import { sameAddress } from '../shared/vault-lifecycle.mjs'
import { fault } from '../shared/incentives.mjs'

export const BULKSENDER={
  address:'0x458b14915e651243acf89c05859a22d5cff976a6',
  implementation:'0xfef30792394a1b0b4ee25faad927ba8e2b2d5d96',
  proxyHash:'0x4a81f2db07b29c615b26787c0643e96f288fc0714d9d7b1e37aa72bfcbf05793',
  implementationHash:'0xa55fd9a544c3707a365547d920f6f4c56c1e9dc0219b687c9506ce549360a465',
  slot:keccak256(stringToHex('bulksender.app.proxy.implementation')),
}
export const bulkAbi=parseAbi(['function bulksendEther(address[] _to,uint256[] _values,bytes32 _uniqueId) payable'])
const bulkEvent=keccak256(stringToHex('LogTokenBulkSent(address,uint256)'))
const hashPattern=/^0x[0-9a-f]{64}$/i
const fail=message=>{throw fault(409,message)}

/** Ordinary RPC only. Direct transactions to the qualified atomic ETH method
 * prove every listed payout or revert together. Arbitrary wrappers do not. */
export async function verifyRefund(hash,source,rpc,{confirmations=2,afterBlock=null}={}) {
  if(!hashPattern.test(hash))throw fault(400,'Provide a transaction hash.')
  if(BigInt(await rpc('eth_chainId',[]))!==4663n)fail('Refund chain is not Robinhood.')
  const [tx,receipt,head]=await Promise.all([rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash]),rpc('eth_blockNumber',[])])
  if(!receipt||!tx||BigInt(head)<BigInt(receipt.blockNumber)+BigInt(confirmations-1))return {state:'pending'}
  const tag=receipt.blockNumber,block=await rpc('eth_getBlockByNumber',[tag,false])
  if(block?.hash!==receipt.blockHash||tx.blockHash!==receipt.blockHash||tx.blockNumber!==tag
    ||!sameAddress(tx.from,source)||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()||tx.hash?.toLowerCase()!==hash.toLowerCase())fail('Refund transaction identity or canonical block changed.')
  // A historical transfer must never close a newly prepared refund. Operators
  // prepare the immutable manifest before sending its external transactions.
  if(afterBlock!==null&&BigInt(tag)<=BigInt(afterBlock))return {state:'ineligible',reason:'predates_manifest',block:{number:tag,hash:block.hash}}
  if(receipt.status==='0x0')return {state:'failed',block:{number:tag,hash:block.hash}}
  if(receipt.status!=='0x1')fail('Refund success is unverified.')
  let payouts,method
  if(tx.input==='0x'&&!sameAddress(tx.to,BULKSENDER.address)){
    if(!tx.to||BigInt(tx.value)<=0n)fail('Refund has no native ETH payout.')
    // A direct value transfer is credited once, independent of receiver logs.
    payouts=[{index:0,recipient:tx.to.toLowerCase(),amountWei:BigInt(tx.value).toString()}];method='direct-eth-v1'
  }else{
    if(!sameAddress(tx.to,BULKSENDER.address))fail('This refund wrapper or sender is not qualified.')
    const parent='0x'+(BigInt(tag)-1n).toString(16)
    const [proxy,implementation,before,after,logs]=await Promise.all([
      rpc('eth_getCode',[BULKSENDER.address,tag]),rpc('eth_getCode',[BULKSENDER.implementation,tag]),
      rpc('eth_getStorageAt',[BULKSENDER.address,BULKSENDER.slot,parent]),rpc('eth_getStorageAt',[BULKSENDER.address,BULKSENDER.slot,tag]),
      rpc('eth_getLogs',[{address:BULKSENDER.address,fromBlock:tag,toBlock:tag}]),
    ])
    if(keccak256(proxy)!==BULKSENDER.proxyHash||keccak256(implementation)!==BULKSENDER.implementationHash
      ||!sameAddress('0x'+before.slice(-40),BULKSENDER.implementation)||before!==after
      ||logs.some(log=>log.removed||log.blockHash!==block.hash||log.topics[0]!==bulkEvent))fail('Bulk sender code or upgrade history requires requalification.')
    let decoded;try{decoded=decodeFunctionData({abi:bulkAbi,data:tx.input})}catch{fail('Unsupported bulk refund method.')}
    if(encodeFunctionData({abi:bulkAbi,functionName:'bulksendEther',args:decoded.args}).toLowerCase()!==tx.input.toLowerCase())fail('Bulk calldata is not canonical.')
    const [recipients,amounts]=decoded.args
    if(recipients.length<2||recipients.length>5000||recipients.length!==amounts.length||!sameAddress(recipients[0],BULKSENDER.address))fail('Invalid bulk refund metadata.')
    const total=amounts.slice(1).reduce((sum,amount)=>sum+amount,0n)
    if(total!==amounts[0]||BigInt(tx.value)<total||amounts.slice(1).some(amount=>amount<=0n))fail('Bulk refund amounts do not balance.')
    payouts=recipients.slice(1).map((recipient,i)=>({index:i+1,recipient:recipient.toLowerCase(),amountWei:amounts[i+1].toString()}));method='bulksender-atomic-eth-v1'
  }
  if((await rpc('eth_getBlockByNumber',[tag,false]))?.hash!==block.hash)fail('Refund block changed during verification.')
  return {state:'verified',hash:hash.toLowerCase(),source:tx.from.toLowerCase(),method,block:{number:tag,hash:block.hash},payouts}
}

export function refundCsv(recipients){return recipients.map(row=>{
  const raw=BigInt(row.amountWei),whole=raw/10n**18n,fraction=(raw%10n**18n).toString().padStart(18,'0')
  return `${row.wallet},${whole}.${fraction}`
}).join('\n')+'\n'}
