import { useState } from 'react'
import type { Address } from 'viem'
import { campaignTerms,campaignPremiumCents } from '../../shared/campaign.mjs'
import { cents,digest,snapshotFor,UINT256_MAX } from '../../shared/incentives.mjs'
import { resolveCapacities } from '../../shared/liquidity-math.mjs'
import type { Offer,Deployment } from '../incentives/model'

// This module is only resolved by vite.preview.config.ts. It has no network,
// wallet-provider or backend imports; all sample changes live in this browser.
export const PREVIEW_ACCOUNT='0x1111111111111111111111111111111111111111' as Address
const key='saffron.campaign-ui-preview.v1'
const token0={address:'0x020bfc650a365f8bb26819deaabf3e21291018b4',symbol:'CASHCAT',decimals:18}
const token1={address:'0x0bd7d308f8e1639fab988df18a8011f41eacad73',symbol:'ETH',decimals:18}
const pair={id:'cashcat-eth',revision:1,chainId:4663,pool:'0xa70fc67c9f69da90b63a0e4c05d229954574e313',feeTier:10000,token0,token1,active:true}
const demoTerms=campaignTerms({days:3,budgetUsd:'10000',capacityUsd:'1000000'})
type PreviewState={budgets:any[];programs:any[];jobs:Deployment[]}

/** Seed the user's half-funded example, clearly labelled as sample data. */
function seed():PreviewState{return {budgets:[{id:'three-day-campaign',revision:1,name:'3-day campaign · sample',chainId:4663,rewardAsset:token0.address,decimals:18,
  campaign:demoTerms,limitRaw:UINT256_MAX.toString(),reservedRaw:'0',allocatedRaw:'0',availableRaw:UINT256_MAX.toString(),paused:false,reconciliationRequired:false,
  fundedCents:'500000',fundedCapacity:'50000000'}],programs:[{id:'three-day-campaign',revision:1,pairId:pair.id,budgetPoolId:'three-day-campaign',apr:Number(demoTerms.aprPercent),days:3,
  minimumCents:'10000',maximumCents:'100000000',sortOrder:0,isNew:true,active:true}],jobs:[]}}
function restore(){try{const saved=JSON.parse(localStorage.getItem(key)??'null');if(saved?.budgets?.length&&Array.isArray(saved.programs)&&Array.isArray(saved.jobs))return saved as PreviewState}catch{}return seed()}
let state=restore()
function save(){localStorage.setItem(key,JSON.stringify(state));window.dispatchEvent(new Event('saffron:catalog-updated'));window.dispatchEvent(new Event('saffron:vault-updated'))}
export function resetPreview(){state=seed();save();location.assign(import.meta.env.BASE_URL)}

/** Apply the same economic ratio as production to browser-only sample requests. */
function budgets(){return state.budgets.map(b=>{
  const jobs=state.jobs.filter(j=>j.programId===b.id&&j.state!=='retired')
  const reserved=jobs.reduce((n,j)=>n+BigInt(j.snapshot.fixedCapacityAmount),0n)
  const reservedBudget=jobs.reduce((n,j)=>n+BigInt(j.plan.premiumCents),0n)
  const funded=BigInt(b.fundedCents??0),capacity=BigInt(b.fundedCapacity??0)
  return {...b,accounting:{budgetCents:b.campaign.budgetCents,targetCapacityCents:b.campaign.capacityCents,fundedBudgetCents:funded.toString(),fundedCapacityCents:capacity.toString(),
    reservedBudgetCents:reservedBudget.toString(),reservedCapacityCents:reserved.toString(),heldBudgetCents:'0',heldCapacityCents:'0',
    availableBudgetCents:(BigInt(b.campaign.budgetCents)-funded-reservedBudget).toString(),availableCapacityCents:(BigInt(b.campaign.capacityCents)-capacity-reserved).toString(),fixedDepositedCents:'0'}}
})}
function offers():Offer[]{return state.programs.map(p=>{const budget=budgets().find(b=>b.id===p.budgetPoolId);return {...pair,...p,pairRevision:1,budget,
  capacityUsd:Number(budget.campaign.capacityCents)/100,eligibleMaximumCents:budget.paused?'0':budget.accounting.availableCapacityCents,availability:budget.paused?'Campaign paused':null}})}
const session=()=>({wallet:PREVIEW_ACCOUNT,csrf:'preview-only',operator:true,expires:Date.now()+1800000})
export async function readSession(){return session()}
export async function ensureOperatorSession(){return {...session(),operator:true}}
export async function ensureSession(){return session()}
export async function authedJson(_account:Address,path:string,body?:any){return requestJson(path,body)}

/** Small in-browser DTO adapter for the real campaign and user-facing components.
 * Unknown paths fail locally. There is deliberately no fetch/RPC fallback. */
export async function requestJson(path:string,body?:any):Promise<any>{
  const route=path.split('?')[0]
  if(route==='/programs')return {offers:offers(),creatorOnline:true}
  if(route==='/session')return {session:session()}
  if(route==='/admin/catalog')return {pairs:[pair],programs:state.programs,budgets:budgets()}
  if(route==='/admin/payments')return {payments:[]}
  if(route==='/admin/status')return {workerOnline:true,pending:0,stalled:0,gasBalanceRaw:null}
  if(route==='/admin/campaigns'&&body){
    const campaign=campaignTerms(body)
    if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(body.id)||state.budgets.some(b=>b.id===body.id))throw new Error('Use a unique campaign ID.')
    if(BigInt(cents(body.minimumUsd))>BigInt(campaign.capacityCents))throw new Error('Minimum request exceeds capacity.')
    state.budgets.push({id:body.id,name:body.name,revision:1,chainId:4663,rewardAsset:token0.address,decimals:18,campaign,
      limitRaw:UINT256_MAX.toString(),reservedRaw:'0',allocatedRaw:'0',availableRaw:UINT256_MAX.toString(),paused:!body.active,reconciliationRequired:false})
    state.programs.push({id:body.id,revision:1,pairId:pair.id,budgetPoolId:body.id,apr:Number(campaign.aprPercent),days:campaign.days,
      minimumCents:cents(body.minimumUsd),maximumCents:campaign.capacityCents,sortOrder:0,isNew:true,active:true});save();return {campaign}
  }
  if(route==='/admin/budgets'&&body){const index=state.budgets.findIndex(b=>b.id===body.id);if(index<0)throw new Error('Sample campaign missing.');state.budgets[index]={...state.budgets[index],paused:body.paused,revision:body.revision+1};save();return {budget:state.budgets[index]}}
  if(['/deployments','/positions','/admin/deployments'].includes(route))return {deployments:state.jobs,nextCursor:null,creatorOnline:true,positionsUpdating:false}
  const match=/^\/deployments\/([^/]+)(\/cancel)?$/.exec(route)
  if(match){const job=state.jobs.find(j=>j.id===match[1]);if(!job)throw new Error('Preview request missing.');if(match[2]){job.state='retired';job.workerState='retired';job.cancelRequested=true;save();return {retired:true}}return {deployment:job}}
  throw new Error('This action is not available in the UI preview. No live request was sent.')
}

/** Static illustrative prices keep review usable without touching a real RPC. */
export function useOfferPrice(offer:Offer|null){return {identity:offer?.id??'',loading:false,value:offer?{quotePerToken:0.000001,quoteUsd:2000,observedAt:new Date().toISOString(),block:'0'}:undefined,error:undefined,refresh:()=>{}}}

/** Exercise the real modal with sample DTOs; Pay simulates only a local request. */
export function useDeploymentFlow(account:Address|null){
  const [quote,setQuote]=useState<any>(null),[deployment,setDeployment]=useState<Deployment|null>(null),[error,setError]=useState<string>()
  async function review(offer:Offer,amount:string){try{
    const principal=cents(amount),current=offers().find(o=>o.id===offer.id)!
    if(current.budget.paused||BigInt(principal)>BigInt(current.eligibleMaximumCents??0))throw new Error('Campaign capacity is exhausted.')
    const snapshot=snapshotFor(current,principal,account),sqrtPrice=(1n<<96n)/1000n
    const capacities=resolveCapacities({cents:principal,aprRaw:snapshot.aprRaw,duration:snapshot.durationSeconds,price0:2n*10n**15n,price1:2000n*10n**18n,variablePrice:2n*10n**15n,
      decimals0:18,decimals1:18,variableDecimals:18,sqrtPrice,minTick:-887200,maxTick:887200})
    const premiumCents=campaignPremiumCents(current.budget.campaign,principal)
    const plan={...capacities,premiumCents,token0,token1,sqrtPrice:sqrtPrice.toString(),minTick:-887200,maxTick:887200,variableDecimals:18,variableSymbol:'CASHCAT'}
    setQuote({id:crypto.randomUUID(),programId:offer.id,principalCents:principal,snapshot,plan,planHash:digest(plan),expiresAt:new Date(Date.now()+120000).toISOString(),fee:{amountWei:'1000000000000000'}});setError(undefined)
  }catch(e){setError((e as Error).message)}}
  async function pay(){if(!quote)return
    const current=offers().find(o=>o.id===quote.programId)!
    if(current.budget.paused||BigInt(quote.principalCents)>BigInt(current.eligibleMaximumCents??0)){setError('Campaign capacity is exhausted.');return}
    const row:Deployment={id:quote.id,wallet:PREVIEW_ACCOUNT,positionWallet:PREVIEW_ACCOUNT,isRequester:true,programId:quote.programId,createdAt:new Date().toISOString(),planHash:quote.planHash,
      snapshot:quote.snapshot,plan:{...quote.plan,vault:'0x3333333333333333333333333333333333333333'},signer:PREVIEW_ACCOUNT,observation:null,state:'awaiting_funding',depositable:false,canClaim:false,canWithdraw:false,canRecover:false,
      workerState:'created',fundingState:'external',cancelRequested:false,error:null,transactions:[],nextAttemptAt:new Date().toISOString(),fundingOperator:null}
    state.jobs.unshift(row);save();setDeployment(row)
  }
  function reset(){setQuote(null);setDeployment(null);setError(undefined)}
  return {quote,deployment,saved:null,busy:false,error,review,pay,reset,discardRejected:reset,recoveryHash:'',setRecoveryHash:()=>{}}
}

/** Lifecycle is display-only in this preview, never routed to an injected wallet. */
export function useVaultPosition(){return {quote:null,pending:null,busy:false,error:undefined,refresh:async()=>{},recover:async()=>{},advance:async()=>{},amountLabel:()=>''}}
