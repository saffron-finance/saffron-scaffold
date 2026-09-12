import type { Address,Hex } from 'viem'
export interface Token {address:Address;symbol:string;decimals:number}
export interface Pair {id:string;revision:number;chainId:number;pool:Address;feeTier:number;token0:Token;token1:Token;active:boolean}
export interface Program {id:string;revision:number;pairId:string;budgetPoolId:string;apr:number;days:number;requestFeeWei:string|null;minimumCents:string;maximumCents:string;sortOrder:number;isNew:boolean;active:boolean}
export interface Budget {advisoryBudgetCents?:string;campaign?:any;accounting?:any;id:string;revision:number;name:string;chainId:number;rewardAsset:Address;decimals:number;limitRaw:string;reservedRaw:string;allocatedRaw:string;availableRaw:string;paused:boolean;reconciliationRequired:boolean}
export interface Offer extends Pair,Program {pairRevision:number;budget:Budget;availability:string|null;vaultTvl?:{status:string;usdRaw:string|null;checkedAt:number|null;block:{number:string;hash:string}|null;priceCheckedAt:number|null}}
export interface PriceSnapshot {quotePerToken:number;quoteUsd:number;observedAt:string;block:string}
export interface DeploymentProgress {version:1;reason:string;stages:{id:number;name:string;state:'pending'|'active'|'complete'|'blocked'|'checking';hash:Hex|null;confirmedAt:string|null}[];activeStage:number|null;requestedAt:string;acceptedAt:string;lastProgressAt:string;checkedAt:string;observedBlock:{number:string;hash:Hex;checkedAt:string}|null;verificationAvailable:boolean;operatorAction:boolean;paymentState:string;serviceWindowMinutes:number|null}
export interface Deployment {refund?:{hash:string;reason:string;state:string;amountWei:string;verifiedWei:string}|null;id:string;wallet:Address;positionWallet:Address;isRequester:boolean;programId:string;createdAt:string;planHash:Hex;plan:any;snapshot:any;signer:Address;observation:any;state:string;depositable:boolean;canClaim:boolean;canWithdraw:boolean;canRecover:boolean;workerState:string;fundingState:string;cancelRequested:boolean;error:string|null;transactions:{hash:Hex;originalHash:Hex;step:string;nonce:string;confirmed:boolean;reverted:boolean}[];nextAttemptAt:string;progress?:DeploymentProgress}
/** Compact token display only; never feed this truncated label into transaction
 * math. Decimal strings from formatUnits preserve exact onchain precision (e.g.
 * 499.999… must not first become 500 via floating-point conversion). Use four
 * places below one, two below 1,000, and one above, with no trailing zeros.
 * Keep sub-display nonzero amounts visible rather than silently printing zero.
 */
export function tokenAmount(value:number|string):string {
  if(typeof value==='number'&&!Number.isFinite(value))return '—'
  const decimal=typeof value==='number'?value.toLocaleString('en-US',{useGrouping:false,maximumFractionDigits:20}):value
  const match=/^(-?)(\d+)(?:\.(\d+))?$/.exec(decimal)
  if(!match)return '—'
  const [,sign,whole,fraction='']=match,integer=BigInt(whole)
  const places=integer===0n?4:integer<1000n?2:1
  const digits=fraction.slice(0,places).replace(/0+$/,'')
  // Numbers smaller than 1e-20 already rendered as zero above; retain their
  // nonzero status from the original value in that one number-input case.
  const nonzero=integer!==0n||/[1-9]/.test(fraction)||(typeof value==='number'&&value!==0)
  if(integer===0n&&!digits&&nonzero)return sign==='-'||Number(value)<0?'>-0.0001':'<0.0001'
  return (nonzero?sign:'')+integer.toLocaleString('en-US')+(digits?'.'+digits:'')
}
export const usd=(value:number)=>value.toLocaleString('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2})
export const compactUsd=(value:number)=>value.toLocaleString('en-US',{style:'currency',currency:'USD',notation:'compact',maximumFractionDigits:1})
export const statusLabel=(state:string)=>({refunded:'Creation fee refunded',refund_pending:'Creation fee refund pending',refund_exception:'Refund verification needs review',queued:'Deployment queued',deploying:'Creating vault',checking:'Checking availability',retired:'Retired',needs_attention:'Needs operator attention',awaiting_funding:'Awaiting campaign funding',depositable:'Depositable',claimable:'Premium claimable',active:'Position active',matured:'Ready to withdraw',completed:'Completed',fixed_awaiting_funding:'Deposit confirmed · vault has not started',retirement_requested:'Retirement requested',occupied:'Fixed side occupied',no_position:'No position held'}[state]??state.replaceAll('_',' '))
