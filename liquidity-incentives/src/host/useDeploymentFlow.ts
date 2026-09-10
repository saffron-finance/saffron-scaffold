import { useState } from 'react'
import { toHex,type Address,type Hex } from 'viem'
import { walletClient,walletPublicClient,assertWalletAccount,ensureChain } from '@lab/wallet/wallet'
import { robinhoodChain } from '@lab/chain/chains'
import { digest,cents } from '../../shared/incentives.mjs'
import { proofHash,paymentData } from '../../shared/payment.mjs'
import { requestJson,rememberPayment,robinhoodClient } from './transport'
import type { Deployment,Offer } from '../incentives/model'

type Payment={quote:any;recoverySecret:Hex;sent:boolean;hash?:Hex;nonce?:number}

/** One native-ETH payment supplies payer identity and consent to the exact quote.
 * Persist before the wallet prompt, and never automatically pay again after an
 * ambiguous response. Public payment hashes alone are not session credentials.
 */
export function useDeploymentFlow(account:Address|null){
  const key='saffron.creation-payment.v1:'+account?.toLowerCase()
  const [saved,setSaved]=useState<Payment|null>(()=>{try{const value=JSON.parse(localStorage.getItem(key)??'null');return value?.quote.wallet===account?.toLowerCase()?value:null}catch{return null}})
  const [quote,setQuote]=useState<any>(saved?.quote??null),[deployment,setDeployment]=useState<Deployment|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>()
  const [recoveryHash,setRecoveryHash]=useState('')
  function persist(value:Payment|null){if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);setSaved(value)}
  async function review(offer:Offer,amount:string){
    if(!account)return
    setBusy(true);setError(undefined)
    try{
      const recoverySecret=toHex(crypto.getRandomValues(new Uint8Array(32)))
      const {quote:q}=await requestJson('/deployment-quotes',{wallet:account,programId:offer.id,amountUsd:amount,recoveryHash:proofHash(recoverySecret)})
      const expected=digest({snapshot:q.snapshot,plan:q.plan,signer:q.signer,programRevision:q.programRevision,pairRevision:q.pairRevision,budgetRevision:q.budgetRevision})
      if(q.origin!==location.origin||q.wallet!==account.toLowerCase()||q.programId!==offer.id||q.principalCents!==cents(amount)||expected!==q.planHash
        ||q.snapshot.poolAddress!==offer.pool||q.snapshot.variableAssetAddress!==offer.token0.address||q.snapshot.durationSeconds!==offer.days*86400
        ||q.fee?.usdCents!=='200'||q.fee.asset!=='ETH'||q.recoveryHash!==proofHash(recoverySecret)||q.paymentData!==paymentData(q))throw new Error('Payment or deployment terms changed. Refresh before paying.')
      await assertWalletAccount(account);setQuote(q);persist({quote:q,recoverySecret,sent:false})
    }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  async function payOrRecover(){
    if(!account||!saved)return
    setBusy(true);setError(undefined)
    try{
      const stored=JSON.parse(localStorage.getItem(key)??'null') as Payment|null
      if(!stored||stored.quote.id!==saved.quote.id)throw new Error('This request changed in another tab. Reload before continuing.')
      let payment={...stored}
      if(!payment.sent){
        if(Date.parse(payment.quote.paymentDeadline)<=Date.now())throw new Error('Payment quote expired. Refresh before paying.')
        await assertWalletAccount(account);await ensureChain(robinhoodChain)
        const nonce=await walletPublicClient(robinhoodChain).getTransactionCount({address:account,blockTag:'pending'})
        payment={...payment,sent:true,nonce};persist(payment)
        try{
          const hash=await walletClient().sendTransaction({chain:robinhoodChain,account,to:payment.quote.fee.recipient,value:BigInt(payment.quote.fee.amountWei),data:paymentData(payment.quote),nonce})
          payment={...payment,hash};persist(payment)
        }catch(cause:any){
          let current=cause;for(let i=0;current&&i<8;i++,current=current.cause)if(current.code===4001){payment={...payment,sent:false};persist(payment);break}
          throw cause
        }
      }
      if(!payment.hash&&/^0x[0-9a-fA-F]{64}$/.test(recoveryHash)){payment={...payment,hash:recoveryHash as Hex};persist(payment)}
      if(!payment.hash)throw new Error('Enter the existing payment transaction hash below. Do not pay again.')
      const receipt=await robinhoodClient.waitForTransactionReceipt({hash:payment.hash,confirmations:2,timeout:60_000,
        onReplaced:replacement=>{payment={...payment,hash:replacement.transaction.hash};persist(payment)}})
      const mined=await robinhoodClient.getTransaction({hash:receipt.transactionHash})
      const cancelled=mined.from.toLowerCase()===account.toLowerCase()&&mined.to?.toLowerCase()===account.toLowerCase()&&mined.value===0n&&mined.input==='0x'&&mined.nonce===payment.nonce
      if(receipt.status!=='success'||cancelled){
        // A proven revert/cancellation did not pay the fee. A fresh quote still
        // requires a new explicit wallet payment, never an automatic resubmission.
        payment={...payment,sent:false,hash:undefined,nonce:undefined};persist(payment)
        throw new Error('Payment reverted or was cancelled. No creation fee was received. Refresh the quote before retrying.')
      }
      const proof={quoteId:payment.quote.id,paymentHash:payment.hash,recoverySecret:payment.recoverySecret}
      const result=await requestJson('/deployments',proof)
      rememberPayment(account,proof,result.session);setDeployment(result.deployment);persist(null)
      window.dispatchEvent(new Event('saffron:vault-updated'))
    }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  async function pay(){
    if(!account)return
    if(!navigator.locks){setError('Use a browser with Web Locks support to coordinate wallet payments.');return}
    await navigator.locks.request('saffron.wallet-action:'+account.toLowerCase(),{ifAvailable:true},async lock=>{
      if(!lock){setError('Another wallet action is in progress.');return}await payOrRecover()
    })
  }
  async function reset(){
    if(saved?.sent){setError('Recover the existing payment before starting another request.');return}
    setBusy(true)
    try{
      if(saved)await requestJson('/deployment-quotes/withdraw',{quoteId:saved.quote.id,recoverySecret:saved.recoverySecret})
      persist(null);setQuote(null);setDeployment(null);setError(undefined)
    }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  return {quote,deployment,saved,busy,error,review,pay,reset,discardRejected:reset,recoveryHash,setRecoveryHash}
}
