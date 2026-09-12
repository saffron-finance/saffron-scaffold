import { useState, useSyncExternalStore } from 'react'
import type { Address } from 'viem'
import { campaignTerms,campaignPremiumCents,campaignRate } from '../../shared/campaign.mjs'
import { cents,digest,snapshotFor,UINT256_MAX } from '../../shared/incentives.mjs'
import { resolveCapacities } from '../../shared/liquidity-math.mjs'
import type { Offer,Deployment } from '../incentives/model'

// This independent edition uses only browser-local incentive adapters. No network,
// wallet-provider or backend imports; all sample changes live in this browser.
export const PREVIEW_ACCOUNT='0x1111111111111111111111111111111111111111' as Address
export const PREVIEW_STORAGE_KEY='saffron.live-apr-merge.campaign-preview.v1'
const key=PREVIEW_STORAGE_KEY
const token0={address:'0x020bfc650a365f8bb26819deaabf3e21291018b4',symbol:'CASHCAT',decimals:18}
const token1={address:'0x0bd7d308f8e1639fab988df18a8011f41eacad73',symbol:'ETH',decimals:18}
const pair={id:'cashcat-eth',revision:1,chainId:4663,pool:'0xa70fc67c9f69da90b63a0e4c05d229954574e313',feeTier:10000,token0,token1,active:true}
const demoTerms=campaignTerms({days:3,budgetUsd:'10000',capacityUsd:'1000000'})
// Match the original target capacity; derive the five-day budget from its APR.
const fiveDayTerms=campaignTerms({days:5,capacityUsd:'1000000',aprPercent:'256.27'})
type PreviewState={budgets:any[];programs:any[];jobs:Deployment[];intake?:any}

/** Build fresh records for the five-day sample with no simulated commitments.
 * Returning new objects keeps Reset independent of edits to a loaded catalog. */
function fiveDayDemo(){return {
  budget:{id:'five-day-campaign',revision:1,name:'5-day campaign · sample',chainId:4663,rewardAsset:token0.address,decimals:18,
    campaign:fiveDayTerms,limitRaw:UINT256_MAX.toString(),reservedRaw:'0',allocatedRaw:'0',availableRaw:UINT256_MAX.toString(),paused:false,reconciliationRequired:false,
    fundedCents:'0',fundedCapacity:'0'},
  program:{id:'five-day-campaign',revision:1,pairId:pair.id,budgetPoolId:'five-day-campaign',apr:Number(fiveDayTerms.aprPercent),days:5,
    minimumCents:'1',maximumCents:UINT256_MAX.toString(),sortOrder:1,isNew:true,active:true},
}}

/** Seed both examples, retaining the original three-day campaign's half funding. */
function seed():PreviewState{const extra=fiveDayDemo();return {budgets:[{id:'three-day-campaign',revision:1,name:'3-day campaign · sample',chainId:4663,rewardAsset:token0.address,decimals:18,
  campaign:demoTerms,limitRaw:UINT256_MAX.toString(),reservedRaw:'0',allocatedRaw:'0',availableRaw:UINT256_MAX.toString(),paused:false,reconciliationRequired:false,
  fundedCents:'500000',fundedCapacity:'50000000'},extra.budget],programs:[{id:'three-day-campaign',revision:1,pairId:pair.id,budgetPoolId:'three-day-campaign',apr:Number(demoTerms.aprPercent),days:3,
  minimumCents:'1',maximumCents:UINT256_MAX.toString(),sortOrder:0,isNew:true,active:true},extra.program],jobs:[]}}
let storageWarning:string|null=null
const storageEvent='saffron:merge-preview-storage'

/** Add the new sample to existing browsers without replacing saved work.
 * Existing IDs win (including paused samples); repeat loads do not duplicate it.
 * If persistence is denied, retain the user's restored data and upgrade in memory. */
function addFiveDayDemo(saved:PreviewState):PreviewState{
  const extra=fiveDayDemo()
  if(saved.budgets.some(b=>b.id===extra.budget.id)||saved.programs.some(p=>p.id===extra.program.id))return saved
  const upgraded={...saved,budgets:[...saved.budgets,extra.budget],programs:[...saved.programs,extra.program]}
  try {localStorage.setItem(key,JSON.stringify(upgraded))}
  catch {storageWarning='Browser storage is unavailable. Preview changes will last only until this page is reloaded.'}
  return upgraded
}
/** Malformed or unavailable storage must not take down the live APR section.
 * Keep samples usable in memory and explain when refresh cannot preserve them. */
function restore(){
  try {
    const raw=localStorage.getItem(key)
    if(raw===null)return seed()
    const saved=JSON.parse(raw)
    if(Array.isArray(saved?.budgets)&&saved.budgets.length&&Array.isArray(saved.programs)&&Array.isArray(saved.jobs)&&saved.budgets.every((b:any)=>b?.campaign?.capacityCents&&b?.campaign?.budgetCents))return addFiveDayDemo(saved as PreviewState)
    storageWarning='Saved preview data could not be read. Fresh sample campaigns are shown.'
  } catch {storageWarning='Browser storage is unavailable. Preview changes will last only until this page is reloaded.'}
  return seed()
}
let state=restore()
/** Write only this edition's sample key; never clear shared-origin storage. */
function save(){
  try {localStorage.setItem(key,JSON.stringify(state));storageWarning=null}
  catch {storageWarning='Browser storage is unavailable. Preview changes will last only until this page is reloaded.'}
  window.dispatchEvent(new Event(storageEvent))
  window.dispatchEvent(new Event('saffron:catalog-updated'))
  window.dispatchEvent(new Event('saffron:vault-updated'))
}
function subscribeStorage(listener:()=>void){window.addEventListener(storageEvent,listener);return()=>window.removeEventListener(storageEvent,listener)}
/** A small external snapshot reports persistence failures without a new store. */
export function usePreviewStorageWarning(){return useSyncExternalStore(subscribeStorage,()=>storageWarning)}
export function resetPreview(){state=seed();save()}

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
  availability:budget.paused?'Campaign paused':null}})}
const session=()=>({wallet:PREVIEW_ACCOUNT,csrf:'preview-only',operator:true,expires:Date.now()+1800000})
export async function readSession(_account?:Address|null,_signal?:AbortSignal){return session()}
export async function ensureOperatorSession(_account?:Address){return {...session(),operator:true}}
export async function ensureSession(_account?:Address){return session()}
export async function authedJson(_account:Address,path:string,body?:any){return requestJson(path,body)}

/** Small in-browser DTO adapter for the real campaign and user-facing components.
 * Unknown paths fail locally. There is deliberately no fetch/RPC fallback. */
export async function requestJson(path:string,body?:any,_options?:unknown):Promise<any>{
  const route=path.split('?')[0]
  if(route==='/programs')return {offers:offers().map(({minimumCents,maximumCents,budget,...offer})=>({...offer,budget:{id:budget.id,revision:budget.revision,paused:budget.paused,campaign:campaignRate(budget.campaign)}})),creatorOnline:true}
  if(route==='/session')return {session:session()}
  if(route==='/admin/catalog')return {pairs:[pair],programs:state.programs,budgets:budgets()}
  if(['/admin/payments','/payments'].includes(route))return {payments:[],nextCursor:null}
  if(route==='/admin/status')return {signer:PREVIEW_ACCOUNT,workerOnline:true,pending:state.jobs.length,stalled:0,readiness:{mode:'reviewed',canQuote:state.intake?.enabled!==false,reasons:[],workerOnline:false,policy:state.intake??null,watcher:null}}
  if(route==='/admin/intake'&&body){state.intake={...body,revision:body.revision+1,expires_at:body.expiresAt,service_minutes:body.serviceMinutes,watcher_id:body.watcherId};save();return {policy:state.intake}}
  if(route==='/admin/portfolio-capacity')return {campaigns:budgets().map(b=>{const committed=BigInt(b.accounting.fundedBudgetCents)+BigInt(b.accounting.reservedBudgetCents),target=BigInt(b.advisoryBudgetCents??b.campaign.budgetCents);return {id:b.id,name:b.name,nearCapacity:committed*100n>=target*90n,overTarget:committed>target,targetBudgetCents:target.toString(),committedBudgetCents:committed.toString()}})}
  const advisory=/^\/admin\/budgets\/([^/]+)\/advisory$/.exec(route)
  if(advisory&&body){const budget=state.budgets.find(b=>b.id===advisory[1]);if(!budget||budget.revision!==body.revision)throw new Error('Planning target changed. Refresh before saving.');budget.advisoryBudgetCents=cents(body.budgetUsd);budget.revision++;save();return {saved:true}}
  if(route==='/admin/campaigns'&&body){
    const campaign=campaignTerms(body)
    if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(body.id)||state.budgets.some(b=>b.id===body.id))throw new Error('Use a unique campaign ID.')
    state.budgets.push({id:body.id,name:body.name,revision:1,chainId:4663,rewardAsset:token0.address,decimals:18,campaign,
      limitRaw:UINT256_MAX.toString(),reservedRaw:'0',allocatedRaw:'0',availableRaw:UINT256_MAX.toString(),paused:!body.active,reconciliationRequired:false})
    state.programs.push({id:body.id,revision:1,pairId:pair.id,budgetPoolId:body.id,apr:Number(campaign.aprPercent),days:campaign.days,
      minimumCents:'1',maximumCents:UINT256_MAX.toString(),sortOrder:0,isNew:true,active:true});save();return {campaign}
  }
  if(route==='/admin/budgets'&&body){const index=state.budgets.findIndex(b=>b.id===body.id);if(index<0)throw new Error('Sample campaign missing.');state.budgets[index]={...state.budgets[index],paused:body.paused,revision:body.revision+1};save();return {budget:state.budgets[index]}}
  if(['/deployments','/positions','/admin/deployments'].includes(route))return {deployments:state.jobs.map(withProgress),nextCursor:null,creatorOnline:true,positionsUpdating:false}
  const match=/^\/deployments\/([^/]+)$/.exec(route)
  if(match){const job=state.jobs.find(j=>j.id===match[1]);if(!job)throw new Error('Preview request missing.');return {deployment:withProgress(job)}}
  throw new Error('This action is not available in the UI preview. No live request was sent.')
}

/** Static illustrative prices keep review usable without touching a real RPC. */
export function useOfferPrice(offer:Offer|null){return {identity:offer?.id??'',loading:false,value:offer?{quotePerToken:0.000001,quoteUsd:2000,observedAt:new Date().toISOString(),block:'0'}:undefined,error:undefined,refresh:()=>{}}}

/** Exercise the real modal with sample DTOs; Pay simulates only a local request. */
export function useDeploymentFlow(account:Address|null){
  const [quote,setQuote]=useState<any>(null),[deployment,setDeployment]=useState<Deployment|null>(null),[error,setError]=useState<string>()
  async function review(offer:Offer,amount:string){try{
    const principal=cents(amount),current=offers().find(o=>o.id===offer.id)!
    if(current.budget.paused||state.intake?.enabled===false)throw new Error('Campaign requests are paused.')
    const snapshot=snapshotFor(current,principal,account),sqrtPrice=(1n<<96n)/1000n
    const capacities=resolveCapacities({cents:principal,aprRaw:snapshot.aprRaw,duration:snapshot.durationSeconds,price0:2n*10n**15n,price1:2000n*10n**18n,variablePrice:2n*10n**15n,
      decimals0:18,decimals1:18,variableDecimals:18,sqrtPrice,minTick:-887200,maxTick:887200})
    const premiumCents=campaignPremiumCents(current.budget.campaign,principal)
    const plan={...capacities,premiumCents,token0,token1,sqrtPrice:sqrtPrice.toString(),minTick:-887200,maxTick:887200,variableDecimals:18,variableSymbol:'CASHCAT'}
    // This local creation request has no price-expiry timer. Actual LP amounts
    // require a fresh, explicit confirmation at deposit, after vault creation.
    setQuote({id:crypto.randomUUID(),programId:offer.id,principalCents:principal,snapshot,plan,planHash:digest(plan),fee:{amountWei:'1000000000000000'}});setError(undefined)
  }catch(e){setError((e as Error).message)}}
  async function pay(){if(!quote)return
    const current=offers().find(o=>o.id===quote.programId)!
    if(current.budget.paused){setError('Campaign requests are paused.');return}
    const existing=state.jobs.find(j=>j.id===quote.id);if(existing){setDeployment(withProgress(existing));return}
    const row:Deployment={id:quote.id,wallet:PREVIEW_ACCOUNT,positionWallet:PREVIEW_ACCOUNT,isRequester:true,programId:quote.programId,createdAt:new Date().toISOString(),planHash:quote.planHash,
      snapshot:quote.snapshot,plan:{...quote.plan,vault:'0x3333333333333333333333333333333333333333'},signer:PREVIEW_ACCOUNT,observation:null,state:'awaiting_funding',depositable:false,canClaim:false,canWithdraw:false,canRecover:false,
      workerState:'created',fundingState:'external',cancelRequested:false,error:null,transactions:[],nextAttemptAt:new Date().toISOString()}
    state.jobs.unshift(row);save();setDeployment(withProgress(row))
  }
  function reset(){setQuote(null);setDeployment(null);setError(undefined)}
  return {quote,deployment,saved:null as import('../host/payment-records.mjs').Payment|null,draft:null as import('../host/payment-records.mjs').CheckoutDraft|null,records:[] as import('../host/payment-records.mjs').Payment[],busy:false,error,review,pay,reset,startNew:reset,restore:reset,resumePayment:(_id:string)=>{},discardRejected:reset,recoveryHash:'',setRecoveryHash:(_value:string)=>{}}
}

/** Adapt old saved samples without rewriting them or inventing chain receipts.
 * C06 is illustrative here. Actual canonical verification lives in the API. */
function withProgress(row:Deployment):Deployment{
  if(row.progress||!row.createdAt||!row.snapshot)return row
  const blocked=['retired','retirement_requested','needs_attention'].includes(row.state)
  return {...row,progress:{version:1,reason:blocked?'operator_review':'awaiting_funding',activeStage:blocked?null:4,
    stages:['Prepare adapter','Create vault','Initialize and verify','Fund premium and enable entry'].map((name,index)=>({id:index+1,name,state:blocked?'blocked':index<3?'complete':'active',hash:null,confirmedAt:null})),
    requestedAt:row.createdAt,acceptedAt:row.createdAt,lastProgressAt:'',checkedAt:new Date().toISOString(),observedBlock:null,
    verificationAvailable:false,operatorAction:blocked,paymentState:'sample',serviceWindowMinutes:null}}
}

/** Lifecycle is display-only in this preview, never routed to an injected wallet. */
export function useVaultPosition(..._args:unknown[]):any{return {quote:null,pending:null,busy:false,error:undefined,refresh:async()=>{},recover:async()=>{},advance:async()=>{},amountLabel:()=>''}}

/** Build-time preview session. This module never imports wallet discovery. */
export function useMergeSession(){return {account:PREVIEW_ACCOUNT,headerAccount:null,preview:true,openModal:()=>{},overlays:null}}
