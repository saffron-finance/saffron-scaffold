import { proofHash,paymentData } from '../shared/payment.mjs'
export { proofHash,paymentData } from '../shared/payment.mjs'
import { fault, validAddress } from '../shared/incentives.mjs'

/** Verify the native ETH transaction itself, not a supplied hash or wallet address.
 * The private browser recovery capability is committed in payment calldata: a
 * public explorer receipt alone can never authenticate another browser session.
 */
export async function verifyPayment(quote,hash,secret,rpc,{confirmations=2,checkCapability=true}={}){
  if(!Number.isInteger(confirmations)||confirmations<2)throw fault(503,'Payment confirmation policy is invalid.')
  if(!quote?.fee)throw fault(400,'This quote has no ETH creation payment.')
  if(!validAddress(quote.wallet)||!validAddress(quote.fee.recipient)||quote.wallet.toLowerCase()===quote.fee.recipient.toLowerCase()
    ||!/^[1-9][0-9]*$/.test(String(quote.fee.amountWei??'')))throw fault(400,'A positive fee must be paid to the configured receiver, not back to the payer.')
  if(!Number.isFinite(Date.parse(quote.paymentDeadline)))throw fault(400,'Payment deadline metadata is invalid.')
  if(checkCapability&&(typeof secret!=='string'||!/^0x[0-9a-f]{64}$/i.test(secret)||proofHash(secret)!==quote.recoveryHash))throw fault(403,'This payment belongs to another request recovery record.')
  if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(hash))throw fault(400,'Provide the payment transaction hash.')
  const [chain,head,tx,receipt]=await Promise.all([rpc('eth_chainId',[]),rpc('eth_blockNumber',[]),rpc('eth_getTransactionByHash',[hash]),rpc('eth_getTransactionReceipt',[hash])])
  if(BigInt(chain)!==4663n||!tx||!receipt)throw fault(409,'Payment is not confirmed yet. Keep this request and retry without paying again.')
  const block=await rpc('eth_getBlockByNumber',[receipt.blockNumber,false])
  // The transaction and receipt must describe the same mined inclusion. A
  // mismatched RPC response must not lend another transaction its confirmations.
  if(tx.hash?.toLowerCase()!==hash.toLowerCase()||tx.blockHash!==receipt.blockHash||tx.blockNumber!==receipt.blockNumber
    ||!/^0x[0-9a-f]{64}$/i.test(block?.hash??'')||!/^0x[0-9a-f]+$/i.test(block?.timestamp??''))throw fault(409,'Payment transaction and block evidence disagree.')
  if(BigInt(block.timestamp)>BigInt(Math.floor(Number.MAX_SAFE_INTEGER/1000)))throw fault(409,'Payment block timestamp is invalid.')
  if(receipt.status==='0x0')throw fault(400,'This transaction reverted and did not pay the creation fee.')
  if(receipt.status!=='0x1'||receipt.transactionHash?.toLowerCase()!==hash.toLowerCase()||block?.hash!==receipt.blockHash
    ||BigInt(head)<BigInt(receipt.blockNumber)+BigInt(confirmations-1))throw fault(409,'Payment needs successful canonical confirmations. Do not pay again.')
  if(!validAddress(tx.from)||tx.from.toLowerCase()!==quote.wallet||tx.to?.toLowerCase()!==quote.fee.recipient
    ||BigInt(tx.value)!==BigInt(quote.fee.amountWei)||tx.input!==paymentData(quote))throw fault(400,'Payment does not match this wallet, exact ETH amount, recipient and vault quote.')
  return {hash:hash.toLowerCase(),wallet:quote.wallet,recipient:quote.fee.recipient,amountWei:quote.fee.amountWei,
    late:Number(BigInt(block.timestamp))*1000>Date.parse(quote.paymentDeadline),quoteId:quote.id,planHash:quote.planHash,blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,verified:true}
}
