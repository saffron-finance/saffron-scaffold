import { fault,validAddress } from '../shared/incentives.mjs'

/** Read-only direct native refunds. A call into a treasury contract is not
 * evidence of an internal ETH transfer and deliberately fails this verifier. */
export async function verifyRefund(payment,hash,rpc,{senders=[],confirmations=2}={}){
  if(!/^0x[0-9a-f]{64}$/i.test(hash??'')||!Number.isInteger(confirmations)||confirmations<2)throw fault(400,'Invalid refund evidence or confirmation policy.')
  const approved=senders.filter(validAddress).map(address=>address.toLowerCase())
  if(!approved.length)throw fault(503,'Approved external refund accounts are not configured.')
  const [chain,head,tx,receipt]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_blockNumber',[]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash])])
  if(BigInt(chain)!==4663n)throw fault(409,'Refund chain does not match the received fee.')
  if(!tx)throw Object.assign(fault(409,'Refund transaction is not available yet.'),{refundState:'unavailable'})
  if(tx.hash?.toLowerCase()!==hash.toLowerCase()||!approved.includes(tx.from?.toLowerCase())||tx.from?.toLowerCase()===payment.wallet
    ||tx.to?.toLowerCase()!==payment.wallet||tx.input!=='0x'||BigInt(tx.value)<=0n)throw fault(400,'Refund must be a direct ETH transfer from an approved account to the original payer.')
  const evidence={hash:hash.toLowerCase(),sender:tx.from.toLowerCase(),wallet:payment.wallet,nonce:BigInt(tx.nonce).toString(),amountWei:BigInt(tx.value).toString()}
  if(!receipt)return {...evidence,state:'confirming'}
  const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false])
  if(tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()||block?.hash!==receipt.blockHash)throw Object.assign(fault(409,'Refund inclusion is not canonical.'),{refundState:'orphaned'})
  if(receipt.status==='0x0'){
    if(BigInt(head)<BigInt(receipt.blockNumber)+BigInt(confirmations-1))throw fault(409,'Refund failure needs canonical confirmations.')
    throw Object.assign(fault(400,'Refund transaction reverted; the payer has not been refunded.'),{refundState:'failed',evidence:{...evidence,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,state:'failed'}})
  }
  if(receipt.status!=='0x1')throw fault(409,'Refund status is unavailable.')
  return {...evidence,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,state:BigInt(head)>=BigInt(receipt.blockNumber)+BigInt(confirmations-1)?'confirmed':'confirming'}
}

export async function verifyRefundReplacement(payment,original,hash,rpc,policy){
  if(!/^0x[0-9a-f]{64}$/i.test(hash??''))throw fault(400,'Provide a replacement transaction hash.')
  const [chain,head,tx,receipt]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_blockNumber',[]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash])])
  if(BigInt(chain)!==4663n||!tx||!receipt||tx.hash?.toLowerCase()!==hash.toLowerCase()||tx.from?.toLowerCase()!==original.evidence.sender||BigInt(tx.nonce).toString()!==original.evidence.nonce
    ||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber
    ||BigInt(head)<BigInt(receipt.blockNumber)+BigInt(policy.confirmations-1)||(await rpc('eth_getBlockByNumber',[receipt.blockNumber,false]))?.hash!==receipt.blockHash)throw fault(409,'The same sender and nonce need canonical replacement evidence.')
  if(receipt.status==='0x1'&&tx.to?.toLowerCase()===tx.from.toLowerCase()&&tx.input==='0x'&&BigInt(tx.value)===0n)return {hash:hash.toLowerCase(),sender:tx.from.toLowerCase(),nonce:original.evidence.nonce,state:'failed',kind:'cancelled',blockNumber:receipt.blockNumber,blockHash:receipt.blockHash}
  const evidence=await verifyRefund(payment,hash,rpc,policy)
  if(evidence.amountWei!==original.amount_wei||evidence.state!=='confirmed')throw fault(409,'Replacement must confirm the exact saved refund or a zero-value self cancellation.')
  return evidence
}
