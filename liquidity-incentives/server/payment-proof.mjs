import { proofHash,paymentData } from '../shared/payment.mjs'
export { proofHash,paymentData } from '../shared/payment.mjs'
import { fault, validAddress } from '../shared/incentives.mjs'

/** Verify the native ETH transaction itself, not a supplied hash or wallet address.
 * The private browser recovery capability is committed in payment calldata: a
 * public explorer receipt alone can never authenticate another browser session.
 */
export async function verifyPayment(quote,hash,secret,rpc,{confirmations=2,checkCapability=true}={}){
  if(!quote?.fee)throw fault(400,'This quote has no ETH creation payment.')
  if(checkCapability&&(typeof secret!=='string'||!/^0x[0-9a-f]{64}$/i.test(secret)||proofHash(secret)!==quote.recoveryHash))throw fault(403,'This payment belongs to another request recovery record.')
  if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(hash))throw fault(400,'Provide the payment transaction hash.')
  const [chain,head,tx,receipt]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_blockNumber',[]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash])])
  if(BigInt(chain)!==4663n||!tx||!receipt)throw fault(409,'Payment is not confirmed yet. Keep this request and retry without paying again.')
  const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false])
  if(receipt.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()||block?.hash!==receipt.blockHash
    ||BigInt(head)<BigInt(receipt.blockNumber)+BigInt(confirmations-1))throw fault(409,'Payment needs successful canonical confirmations. Do not pay again.')
  if(!validAddress(tx.from)||tx.from.toLowerCase()!==quote.wallet||tx.to?.toLowerCase()!==quote.fee.recipient
    ||BigInt(tx.value)!==BigInt(quote.fee.amountWei)||tx.input!==paymentData(quote))throw fault(400,'Payment does not match this wallet, exact ETH amount, recipient and vault quote.')
  return {hash:hash.toLowerCase(),wallet:quote.wallet,recipient:quote.fee.recipient,amountWei:quote.fee.amountWei,
    late:Number(BigInt(block.timestamp))*1000>Date.parse(quote.paymentDeadline),quoteId:quote.id,planHash:quote.planHash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,verified:true}
}
