import { useEffect,useRef,useState } from 'react'
import { toHex,type Address,type Hex } from 'viem'
import { walletClient,walletPublicClient,assertWalletAccount,ensureChain } from '@lab/wallet/wallet'
import { robinhoodChain } from '@lab/chain/chains'
import { digest,cents } from '../../shared/incentives.mjs'
import { proofHash,paymentData } from '../../shared/payment.mjs'
import { requestJson,rememberPayment,robinhoodClient } from './transport'
import { readPayments,savePayment,saveCheckoutDraft,type Payment,type Payments,type CheckoutDraft } from './payment-records.mjs'
import type { Deployment,Offer } from '../incentives/model'

export function useDeploymentFlow(account:Address|null){
  const [saved,setSaved]=useState<Payment|null>(null),[deployment,setDeployment]=useState<Deployment|null>(null)
  const [draft,setDraft]=useState<CheckoutDraft|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>(),[recoveryHash,setRecoveryHash]=useState('')
  const alive=useRef(true)
  const update=(ledger:Payments)=>{if(alive.current){setSaved(ledger.activeId?ledger.records[ledger.activeId]:null);setDraft(ledger.draft??null)}}
  function restore(){
    if(!account)return
    try{update(readPayments(localStorage,account));setDeployment(null)}catch(cause){setError((cause as Error).message)}
  }
  useEffect(()=>{
    alive.current=true;restore()
    const changed=()=>{try{if(account)update(readPayments(localStorage,account))}catch(cause){setError((cause as Error).message)}}
    window.addEventListener('storage',changed);window.addEventListener('saffron:payment-record',changed)
    return()=>{alive.current=false;window.removeEventListener('storage',changed);window.removeEventListener('saffron:payment-record',changed)}
  },[account])
  async function coordinated(operation:(ledger:Payments,persist:(payment:Payment,active?:boolean)=>void,prepare:(draft:CheckoutDraft|null)=>void)=>Promise<void>){
    if(!account)return
    if(!navigator.locks){setError('Use a browser with Web Locks support to coordinate wallet payments.');return}
    setBusy(true);setError(undefined)
    try{await navigator.locks.request('saffron.wallet-action:'+account.toLowerCase(),{ifAvailable:true},async lock=>{
      if(!lock)throw new Error('Another wallet action is in progress.')
      let ledger=readPayments(localStorage,account);update(ledger)
      await operation(ledger,(payment,active=true)=>{
        ledger=savePayment(localStorage,account,ledger,payment,{active});update(ledger)
        window.dispatchEvent(new Event('saffron:payment-record'))
      },draft=>{ledger=saveCheckoutDraft(localStorage,account,ledger,draft);update(ledger);window.dispatchEvent(new Event('saffron:payment-record'))})
    })}catch(cause){if(alive.current)setError((cause as Error).message)}finally{if(alive.current)setBusy(false)}
  }
  const review=(offer:Offer,amount:string)=>coordinated(async(ledger,persist,prepare)=>{
    if(!account)return
    if(ledger.activeId)throw new Error('Resume or close the saved payment review before starting another request.')
    const draft=ledger.draft??{requestKey:crypto.randomUUID(),wallet:account.toLowerCase(),programId:offer.id,amountUsd:amount,recoverySecret:toHex(crypto.getRandomValues(new Uint8Array(32)))}
    if(draft.programId!==offer.id||cents(draft.amountUsd)!==cents(amount))throw new Error('Resume the saved checkout amount or discard its unpaid review before changing terms.')
    prepare(draft)
    const {recoverySecret,requestKey}=draft
    await requestJson('/checkout/session',{})
    const {quote:q}=await requestJson('/deployment-quotes',{wallet:account,programId:offer.id,amountUsd:amount,recoveryHash:proofHash(recoverySecret),requestKey})
    const expected=digest({snapshot:q.snapshot,plan:q.plan,signer:q.signer,programRevision:q.programRevision,pairRevision:q.pairRevision,budgetRevision:q.budgetRevision})
    if(q.origin!==location.origin||q.wallet!==account.toLowerCase()||q.programId!==offer.id||q.principalCents!==cents(amount)||expected!==q.planHash
      ||q.snapshot.poolAddress!==offer.pool||q.snapshot.variableAssetAddress!==offer.token0.address||q.snapshot.durationSeconds!==offer.days*86400
      ||q.fee?.usdCents!=='200'||q.fee.asset!=='ETH'||q.recoveryHash!==proofHash(recoverySecret)||q.paymentData!==paymentData(q))throw new Error('Payment or deployment terms changed. Refresh before paying.')
    await assertWalletAccount(account);persist({quote:q,recoverySecret,sent:false,status:'prepared'})
  })
  const pay=()=>coordinated(async(ledger,persist)=>{
    if(!account||!ledger.activeId)return
    let payment={...ledger.records[ledger.activeId]}
    const finish=(result:any)=>{
      payment={...payment,status:'accepted',deploymentId:result.deployment.id};persist(payment)
      const proof={quoteId:payment.quote.id,paymentHash:payment.hash,recoverySecret:payment.recoverySecret}
      rememberPayment(account,proof,result.session)
      persist(payment,false)
      if(alive.current)setDeployment(result.deployment)
      window.dispatchEvent(new Event('saffron:vault-updated'))
    }
    if(payment.status==='confirmed_unpaid')throw new Error('Refresh the quote before making another explicit payment.')
    if(!payment.sent){
      if(Date.parse(payment.quote.paymentDeadline)<=Date.now())throw new Error('Payment quote expired. Refresh before paying.')
      await assertWalletAccount(account);await ensureChain(robinhoodChain)
      const nonce=await walletPublicClient(robinhoodChain).getTransactionCount({address:account,blockTag:'pending'})
      await assertWalletAccount(account)
      payment={...payment,sent:true,status:'submitting',nonce};persist(payment)
      try{
        const hash=await walletClient().sendTransaction({chain:robinhoodChain,account,to:payment.quote.fee.recipient,value:BigInt(payment.quote.fee.amountWei),data:paymentData(payment.quote),nonce})
        payment={...payment,hash,status:'submitted'};persist(payment)
      }catch(cause:any){
        let current=cause;for(let i=0;current&&i<8;i++,current=current.cause)if(current.code===4001){payment={...payment,sent:false,status:'prepared',nonce:undefined};persist(payment);break}
        throw cause
      }
    }
    if(!payment.hash){
      const recovered=await requestJson('/payments/recover',{quoteId:payment.quote.id,recoverySecret:payment.recoverySecret})
      if(recovered.paymentHash){payment={...payment,hash:recovered.paymentHash,status:'submitted'};persist(payment)}
      if(recovered.deployment){finish(recovered);return}
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
    finish(await requestJson('/deployments',{quoteId:payment.quote.id,paymentHash:payment.hash,recoverySecret:payment.recoverySecret}))
  })
  const reset=()=>coordinated(async(ledger,persist,prepare)=>{
    const current=ledger.activeId?ledger.records[ledger.activeId]:null
    if(current?.sent)throw new Error('Recover the existing payment before starting another request.')
    if(ledger.draft){
      await requestJson('/checkout/session',{})
      const {quote}=await requestJson('/checkout/recover',{requestKey:ledger.draft.requestKey,recoverySecret:ledger.draft.recoverySecret})
      if(quote)await requestJson('/deployment-quotes/withdraw',{quoteId:quote.id,recoverySecret:ledger.draft.recoverySecret})
      prepare(null)
    }
    if(current){await requestJson('/deployment-quotes/withdraw',{quoteId:current.quote.id,recoverySecret:current.recoverySecret});persist({...current,status:'abandoned'},false)}
    if(alive.current){setDeployment(null);setRecoveryHash('')}
  })
  return {quote:saved?.quote??null,deployment,saved,draft,busy,error,review,pay,reset,restore,discardRejected:reset,recoveryHash,setRecoveryHash}
}
