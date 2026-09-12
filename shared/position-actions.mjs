import { encodeFunctionData,encodeAbiParameters } from 'viem'
import { abi,eligibility } from './vault-lifecycle.mjs'
import { amountsForLiquidity } from './liquidity-math.mjs'

/** Exact protocol encoding from fresh ownership, chain time and actual minted liquidity. */
export function positionAction(snapshot,mode,now=Date.now()){
  if(eligibility(snapshot,now).state==='checking')throw new Error('Position evidence is stale. Refresh before continuing.')
  if(mode==='claim'){
    if(!snapshot.isStarted||BigInt(snapshot.claimBalance)<=0n)throw new Error('No started claim is owned by this wallet.')
    return {stage:'claim',label:'Claim premium',to:snapshot.vault,data:encodeFunctionData({abi,functionName:'claim'}),value:0n}
  }
  if(!['withdraw','recover'].includes(mode))throw new Error('Unknown position action.')
  if(snapshot.isStarted){
    if(BigInt(snapshot.blockTimestamp)<=BigInt(snapshot.endTime))throw new Error('The position has not matured.')
    if(BigInt(snapshot.claimBalance)>0n)throw new Error('Claim the premium before withdrawing your fixed position.')
    if(BigInt(snapshot.fixedBalance)<=0n)throw new Error('This wallet does not own the fixed bearer token.')
  }else if(BigInt(snapshot.claimBalance)<=0n)throw new Error('This wallet has no pre-start deposit to recover.')
  const amounts=amountsForLiquidity(snapshot.adapterLiquidity,snapshot.sqrtPrice,snapshot.minTick,snapshot.maxTick)
  const data=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],
    [amounts.amount0*9950n/10000n,amounts.amount1*9950n/10000n,BigInt(snapshot.headTimestamp+300)])
  return {stage:snapshot.isStarted?'withdraw':'recover',label:snapshot.isStarted?'Withdraw LP assets':'Recover LP assets',to:snapshot.vault,
    data:encodeFunctionData({abi,functionName:'withdraw',args:[0n,data]}),value:0n,amounts:[amounts.amount0,amounts.amount1]}
}
