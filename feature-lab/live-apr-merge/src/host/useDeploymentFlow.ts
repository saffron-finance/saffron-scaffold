import { useEffect,useRef,useState } from 'react'
import { toHex,type Address,type Hex } from 'viem'
import { walletClient,assertWalletAccount,ensureChain } from '@lab/wallet/wallet'
import { robinhoodChain } from '@lab/chain/chains'
import { digest,cents,integer } from '../../shared/incentives.mjs'
import { proofHash,paymentData } from '../../shared/payment.mjs'
import { requestJson,rememberPayment,robinhoodClient } from './transport'
import { readPayments,savePayment,saveCheckoutDraft,selectPayment,nextPaymentNonce,retryPaymentNonce,type Payment,type Payments,type CheckoutDraft } from './payment-records.mjs'
import type { Deployment,Offer } from '../incentives/model'

export function useDeploymentFlow(account:Address|null){
  const [saved,setSaved]=useState<Payment|null>(null),[deployment,setDeployment]=useState<Deployment|null>(null)
  const [records,setRecords]=useState<Payment[]>([])
  const [draft,setDraft]=useState<CheckoutDraft|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),[recoveryHash,setRecoveryHash]=useState('')
  // Quote preparation is single-flight background work, not a wallet send.
  // Its promise outlives a modal; the local draft remains the recovery anchor.
  const [preparing,setPreparing]=useState(false)
  const preparation=useRef<Promise<any|null>|null>(null)
  // Navigation invalidates the visible review immediately. The durable ledger
  // stays intact until background withdrawal succeeds, including lost replies.
  const [reviewHidden,setReviewHidden]=useState(false)
  const reviewRevision=useRef(0),cleanupNeeded=useRef(false)
  const cleanup=useRef<Promise<boolean>|null>(null)
  const alive=useRef(true)
  const owner=useRef(account);owner.current=account
  const isCurrent=()=>alive.current&&owner.current===account
  const update=(ledger:Payments)=>{if(isCurrent()){setSaved(ledger.activeId?ledger.records[ledger.activeId]:null);setDraft(ledger.draft??null);setRecords(Object.values(ledger.records))}}
  function restore(){
    if(!account)return
    try{update(readPayments(localStorage,account));setDeployment(null)}catch(cause){setError((cause as Error).message)}
  }
  useEffect(()=>{
    alive.current=true;reviewRevision.current++;preparation.current=null;cleanup.current=null;cleanupNeeded.current=false
    setReviewHidden(false);setPreparing(false);setSaved(null);setDraft(null);setRecords([]);setDeployment(null);setError(undefined);setRecoveryHash('');setBusy(false);restore()
    const changed=()=>{try{if(account)update(readPayments(localStorage,account))}catch(cause){setError((cause as Error).message)}}
    window.addEventListener('storage',changed);window.addEventListener('saffron:payment-record',changed)
    return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener('saffron:payment-record',changed)}
  },[account])
  async function coordinated(operation:(ledger:Payments,persist:(payment:Payment,active?:boolean)=>void,prepare:(draft:CheckoutDraft|null)=>void)=>Promise<void>,foreground=true,relevant=isCurrent):Promise<boolean>{
    if(!account)return true
    if(!navigator.locks){setError('Use a browser with Web Locks support to coordinate wallet payments.');return false}
    if(foreground)setBusy(true)
    if(relevant())setError(undefined)
    try{await navigator.locks.request('saffron.wallet-action:'+account.toLowerCase(),{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('Another wallet action is in progress.')
      let ledger=readPayments(localStorage,account);update(ledger)
      await operation(ledger,(payment,active=true)=>{
        ledger=savePayment(localStorage,account,ledger,payment,{active});update(ledger)
        window.dispatchEvent(new Event('saffron:payment-record'))
      },draft=>{ledger=saveCheckoutDraft(localStorage,account,ledger,draft);update(ledger);window.dispatchEvent(new Event('saffron:payment-record'))})
    });return true}catch(cause){if(relevant())setError((cause as Error).message);return false}finally{if(foreground&&isCurrent())setBusy(false)}
  }
  function finish(payment:Payment,persist:(payment:Payment,active?:boolean)=>void,result:any){
    if(!account)return
    payment={...payment,status:'accepted',deploymentId:result.deployment.id};persist(payment)
    rememberPayment(account,{quoteId:payment.quote.id,paymentHash:payment.hash,recoverySecret:payment.recoverySecret},result.session)
    persist(payment,false)
    if(isCurrent())setDeployment(result.deployment)
    window.dispatchEvent(new Event('saffron:vault-updated'))
  }
  const recover=()=>coordinated(async(ledger,persist)=>{
    const payment=ledger.activeId?ledger.records[ledger.activeId]:null
    if(!payment?.sent)return
    const result=await requestJson('/payments/recover',{quoteId:payment.quote.id,recoverySecret:payment.recoverySecret})
    const next={...payment,hash:result.paymentHash??payment.hash}
    if(result.deployment){finish(next,persist,result);return}
    const status=result.state==='needs_attention'?'needs_attention':payment.status
    if(payment.resolutionState!==result.state||next.hash!==payment.hash)persist({...next,status,resolutionState:result.state})
  })
  function review(offer:Offer,amount:string):Promise<any|null>{
    if(preparation.current)return preparation.current
    // A failed cleanup keeps its recovery record. Retry it only on another
    // explicit Continue/Claim, never on a polling timer or while navigating.
    if(cleanupNeeded.current&&!cleanup.current)void reset(true)
    const pendingCleanup=cleanup.current,revision=reviewRevision.current
    const relevant=()=>isCurrent()&&revision===reviewRevision.current
    setPreparing(true);setError(undefined)
    let prepared:any=null
    const task=(async()=>{
    // Queue a new quote behind the previous cancellation without holding the
    // screen or acquiring competing Web Locks. Back can invalidate this wait.
    if(pendingCleanup&&!await pendingCleanup)return null
    if(!relevant())return null
    const ok=await coordinated(async(ledger,persist,prepare)=>{
    if(!account)return
    await assertWalletAccount(account);await ensureChain(robinhoodChain)
    if(ledger.activeId)throw new Error('Resume or close the saved payment review before starting another request.')
    const draft=ledger.draft??{requestKey:crypto.randomUUID(),wallet:account.toLowerCase(),programId:offer.id,amountUsd:amount,recoverySecret:toHex(crypto.getRandomValues(new Uint8Array(32)))}
    if(draft.programId!==offer.id||cents(draft.amountUsd)!==cents(amount))throw new Error('Resume the saved checkout amount or discard its unpaid review before changing terms.')
    prepare(draft)
    const {recoverySecret,requestKey}=draft
    await requestJson('/checkout/session',{})
    const {quote:q}=await requestJson('/deployment-quotes',{wallet:account,programId:offer.id,amountUsd:amount,recoveryHash:proofHash(recoverySecret),requestKey})
    const expected=digest({snapshot:q.snapshot,plan:q.plan,signer:q.signer,programRevision:q.programRevision,pairRevision:q.pairRevision,budgetRevision:q.budgetRevision})
    if(q.origin!==location.origin||q.wallet!==account.toLowerCase()||q.programId!==offer.id||expected!==q.planHash
      ||q.snapshot.poolAddress!==offer.pool||q.snapshot.variableAssetAddress!==offer.token0.address||q.snapshot.durationSeconds!==offer.days*86400
      ||q.fee?.amountWei!==offer.requestFeeWei||integer(q.fee.amountWei,{positive:true})!==q.fee.amountWei||q.fee.asset!=='ETH'||q.recoveryHash!==proofHash(recoverySecret)||q.paymentData!==paymentData(q))throw new Error('Payment or deployment terms changed. Refresh before paying.')
    await assertWalletAccount(account)
    if(!isCurrent())throw new Error('Wallet changed during request preparation. Reopen the review.')
    persist({quote:q,recoverySecret,sent:false,status:'prepared'})
    // An old response must still be saved for cancellation/recovery, but it
    // must never resurrect the review that Back has already left.
    if(relevant()){prepared=q;setReviewHidden(false)}
    },false,relevant)
    return ok?prepared:null
    })()
    preparation.current=task
    void task.finally(()=>{if(preparation.current===task)preparation.current=null;if(relevant())setPreparing(false)})
    return task
  }
  const pay=(retryMissingHash=false,expectedQuoteId?:string)=>coordinated(async(ledger,persist)=>{
    if(!account||!ledger.activeId)return
    if(expectedQuoteId&&ledger.activeId!==expectedQuoteId)throw new Error('The selected request changed. Review it before paying.')
    let payment={...ledger.records[ledger.activeId]}
    const accepted=(result:any)=>finish(payment,persist,result)
    if(payment.status==='confirmed_unpaid')throw new Error('Refresh the quote before making another explicit payment.')
    if(payment.sent){
      const recovered=await requestJson('/payments/recover',{quoteId:payment.quote.id,recoverySecret:payment.recoverySecret})
      if(recovered.deployment){payment={...payment,hash:recovered.paymentHash??payment.hash};accepted(recovered);return}
      if(recovered.paymentHash){payment={...payment,hash:recovered.paymentHash,status:'submitted'};persist(payment)}
    }
    if(payment.sent&&!payment.hash&&/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)){payment={...payment,hash:recoveryHash as Hex};persist(payment)}
    const retrying=retryMissingHash&&payment.sent&&!payment.hash
    if(!payment.sent||retrying){
      if(!retrying&&Date.parse(payment.quote.paymentDeadline)<=Date.now())throw new Error('Payment quote expired. Refresh before paying.')
      await assertWalletAccount(account);await ensureChain(robinhoodChain)
      const [latestNonce,pendingNonce]=await Promise.all([
        robinhoodClient.getTransactionCount({address:account,blockTag:'latest'}),
        robinhoodClient.getTransactionCount({address:account,blockTag:'pending'}),
      ])
      const nonce=retrying?retryPaymentNonce(payment,latestNonce,pendingNonce):nextPaymentNonce(ledger.records,latestNonce,pendingNonce)
      await assertWalletAccount(account)
      payment={...payment,sent:true,status:'submitting',nonce};persist(payment)
      try{
        const hash=await walletClient().sendTransaction({chain:robinhoodChain,account,to:payment.quote.fee.recipient,value:BigInt(payment.quote.fee.amountWei),data:paymentData(payment.quote),nonce})
        payment={...payment,hash,status:'submitted'};persist(payment)
      }catch(cause:any){
        // Rejecting a retry does not prove the original unknown send was unpaid.
        let current=cause;for(let i=0;!retrying&&current&&i<8;i++,current=current.cause)if(current.code===4001){payment={...payment,sent:false,status:'prepared',nonce:undefined};persist(payment);break}
        throw cause
      }
    }
    if(!payment.hash){
      const recovered=await requestJson('/payments/recover',{quoteId:payment.quote.id,recoverySecret:payment.recoverySecret})
      if(recovered.paymentHash){payment={...payment,hash:recovered.paymentHash,status:'submitted'};persist(payment)}
      if(recovered.deployment){accepted(recovered);return}
    }
    if(!payment.hash&&/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)){payment={...payment,hash:recoveryHash as Hex};persist(payment)}
    if(!payment.hash)throw new Error('Payment discovery is pending. Check again or enter the existing transaction hash. Do not pay again.')
    payment={...payment,status:'confirming'};persist(payment)
    const receipt=await robinhoodClient.waitForTransactionReceipt({hash:payment.hash as Hex,confirmations:2,timeout:60_000,
      onReplaced:replacement=>{payment={...payment,hash:replacement.transaction.hash};persist(payment)}})
    const mined=await robinhoodClient.getTransaction({hash:receipt.transactionHash})
    if(mined.from.toLowerCase()!==account.toLowerCase()||mined.nonce!==payment.nonce)throw new Error('Transaction does not match the saved payer and nonce.')
    const cancelled=mined.to?.toLowerCase()===account.toLowerCase()&&mined.value===0n&&mined.input==='0x'
    if(receipt.status!=='success'||cancelled){
      payment={...payment,sent:false,status:'confirmed_unpaid'};persist(payment)
      throw new Error('Payment reverted or was cancelled. No creation fee was received. Refresh the quote before retrying.')
    }
    accepted(await requestJson('/deployments',{quoteId:payment.quote.id,paymentHash:payment.hash,recoverySecret:payment.recoverySecret}))
  })
  /** Hide an unpaid review synchronously; finish cancellation independently.
   * Background mode never disables navigation. Awaiting callers still receive
   * the actual server result before changing the selected checkout. */
  function reset(background=false):Promise<boolean>{
    if(saved?.sent){setError('Recover the existing payment before starting another request.');return Promise.resolve(false)}
    const pendingPreparation=preparation.current,pendingCleanup=cleanup.current
    reviewRevision.current++;preparation.current=null;cleanupNeeded.current=true
    setReviewHidden(true);setPreparing(false);setError(undefined)
    const task=(async()=>{
    await pendingCleanup;await pendingPreparation
    if(!isCurrent())return false
    const ok=await coordinated(async(ledger,persist,prepare)=>{
    const current=ledger.activeId?ledger.records[ledger.activeId]:null
    if(current?.sent)throw new Error('Recover the existing payment before starting another request.')
    if(ledger.draft){
      await requestJson('/checkout/session',{})
      const {quote}=await requestJson('/checkout/recover',{requestKey:ledger.draft.requestKey,recoverySecret:ledger.draft.recoverySecret})
      if(quote)await requestJson('/deployment-quotes/withdraw',{quoteId:quote.id,recoverySecret:ledger.draft.recoverySecret})
      prepare(null)
    }
    if(current){await requestJson('/deployment-quotes/withdraw',{quoteId:current.quote.id,recoverySecret:current.recoverySecret});persist({...current,status:'abandoned'},false)}
    if(isCurrent()){setDeployment(null);setRecoveryHash('')}
    },!background)
    return ok
    })()
    cleanup.current=task
    void task.then(ok=>{if(cleanup.current===task){cleanupNeeded.current=!ok;cleanup.current=null}})
    return task
  }
  // Navigation changes the active checkout only. It never abandons sent fees.
  const select=async(id:string|null=null)=>{if(cleanup.current&&!await cleanup.current)return false;await preparation.current;return coordinated(async ledger=>{
    if(!account)return
    if(ledger.draft)throw new Error('Resume the saved checkout before starting another request.')
    update(selectPayment(localStorage,account,ledger,id))
    setReviewHidden(false);setDeployment(null);setRecoveryHash('');window.dispatchEvent(new Event('saffron:payment-record'))
  })}
  return {preparing,quote:reviewHidden?null:saved?.quote??null,deployment,saved,draft,busy,error,records,startNew:()=>select(),resumePayment:(id:string)=>select(id),review,pay,recover,reset,restore,discardRejected:reset,recoveryHash,setRecoveryHash}
}
