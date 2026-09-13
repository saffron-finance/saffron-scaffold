import { encodeAbiParameters,encodeFunctionData,type Address,type Hex } from 'viem'
import { abi,eligibility,sameAddress } from '../../shared/vault-lifecycle.mjs'
import type { Deployment } from '../incentives/model'

export const fundingStorageKey=(account:string,id:string)=>'saffron.campaign-funding.v1:'+account.toLowerCase()+':'+id
export const campaignWithdrawalStorageKey=(account:string,id:string)=>'saffron.campaign-withdrawal.v1:'+account.toLowerCase()+':'+id

/** Build only the withdrawal permitted by fresh server policy and this wallet's
 * bearer balance. The vault burns all of its variable-side shares, not the
 * requester's fixed position and not another funder's balance. */
export function campaignWithdrawalQuote(value:any,now=Date.now()){
  const {snapshot:s,deployment,withdrawal:w}=value,control=deployment?.programControl
  if(!control||!['paused','closed'].includes(control.state)||!Number.isFinite(control.checkedAt)||now-control.checkedAt>15000||control.checkedAt>now+1000)throw new Error('Pause or close this program before withdrawing; refresh if its status changed.')
  if(eligibility(s,now).state==='checking'||!sameAddress(s.vault,deployment.plan.vault))throw new Error('Current vault state is unavailable. Refresh before withdrawing.')
  if(!w?.allowed)throw new Error(w?.reason??'Withdrawal is unavailable.')
  if(!/^\d+$/.test(w.bearerBalance)||BigInt(w.bearerBalance)<=0n||!['premium','earnings'].includes(w.phase))throw new Error('No variable-side withdrawal is available to this wallet.')
  const amount=BigInt(w.bearerBalance)
  return {snapshot:s,tokens:[{address:s.variableAsset as Address,decimals:s.variableDecimals,symbol:s.variableSymbol}],rawAmounts:[amount],maximums:[amount],blocked:null,
    phase:w.phase as 'premium'|'earnings',action:{stage:'campaign-withdraw',label:w.phase==='premium'?'Withdraw unused premium':'Withdraw variable-side earnings',to:s.vault as Address,
      data:encodeFunctionData({abi,functionName:'withdraw',args:[1n,'0x']}),value:0n}}
}

/** Derive spending from current trusted-factory state, never from the original
 * premium or a token transfer balance. Only bearer supply counts as funding. */
export function campaignFundingTerms(row:Deployment,now=Date.now()){
  const s=row.observation
  if(eligibility(s,now).state==='checking'||!s?.initialized||!sameAddress(s.vault,row.plan.vault))throw new Error('Current vault funding is unavailable. Refresh before continuing.')
  if(row.workerState!=='created'||row.cancelRequested||row.refund||s.isStarted)throw new Error('This vault is no longer accepting campaign funding.')
  const remaining=BigInt(s.variableCapacity)-BigInt(s.variableSupply)
  if(remaining<=0n)throw new Error('This vault is already fully funded. No additional payment is needed.')
  return {vault:s.vault as Address,token:{address:s.variableAsset as Address,decimals:s.variableDecimals as number,symbol:s.variableSymbol as string},remaining}
}

/** Approve only the reviewed remainder. The variable deposit's minimum amount
 * makes a competing funder's capacity change revert, rather than silently fill
 * a different amount while this wallet's confirmation dialog is open. */
export function campaignFundingAction(terms:ReturnType<typeof campaignFundingTerms>,allowance:bigint):{stage:string;label:string;to:Address;data:Hex;value:bigint}{
  const {vault,token,remaining}=terms
  if(allowance<remaining){
    const reset=allowance>0n
    return {stage:reset?'fund-reset':'fund-approve',label:(reset?'Reset ':'Approve ')+token.symbol,to:token.address,
      data:encodeFunctionData({abi,functionName:'approve',args:[vault,reset?0n:remaining]}),value:0n}
  }
  return {stage:'fund',label:'Fund campaign',to:vault,value:0n,
    data:encodeFunctionData({abi,functionName:'deposit',args:[remaining,1n,encodeAbiParameters([{type:'uint256'}],[remaining])]})}
}
