import { decodeFunctionData,decodeEventLog } from 'viem'
import { abi,sameAddress } from './vault-lifecycle.mjs'
const zero='0x'+'0'.repeat(40)

/** Receipt events prove this wallet's action, rather than inferring withdrawal from a zero balance. */
export function userActionEvidence({receipt,transaction,job}){
  if(receipt.status!=='0x1'||!sameAddress(transaction.from,job.wallet)||!sameAddress(transaction.to,job.plan.vault)||BigInt(transaction.value)!==0n)throw new Error('Transaction does not match this position.')
  const call=decodeFunctionData({abi,data:transaction.input})
  const events=receipt.logs.filter(log=>!log.removed).flatMap(log=>{try{return [{address:log.address,...decodeEventLog({abi,data:log.data,topics:log.topics})}]}catch{return []}})
  if(call.functionName==='claim'){
    const burned=events.find(e=>sameAddress(e.address,job.observation.claimToken)&&e.eventName==='Transfer'&&sameAddress(e.args.from,job.wallet)&&e.args.to?.toLowerCase()===zero&&e.args.value>0n)
    const minted=events.find(e=>sameAddress(e.address,job.observation.fixedBearerToken)&&e.eventName==='Transfer'&&e.args.from?.toLowerCase()===zero&&sameAddress(e.args.to,job.wallet)&&e.args.value===burned?.args.value)
    if(!burned||!minted)throw new Error('Claim token conversion was not confirmed.')
    return 'claim'
  }
  const expected=call.functionName==='deposit'&&call.args[1]===0n?'FundsDeposited':call.functionName==='withdraw'&&call.args[0]===0n?'FundsWithdrawn':null
  const event=events.find(e=>sameAddress(e.address,job.plan.vault)&&e.eventName===expected&&e.args.side===0n&&sameAddress(e.args.user,job.wallet))
  if(!event)throw new Error('The expected fixed-side action was not confirmed.')
  return expected==='FundsDeposited'?'deposit':event.args.isEarly?'recover':'withdraw'
}
