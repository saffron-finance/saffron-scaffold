import { useState } from 'react'
import type { Address,Hex } from 'viem'
import { walletClient,assertWalletAccount,ensureChain } from '@lab/wallet/wallet'
import { robinhoodChain } from '@lab/chain/chains'
import { deploymentTypedData,digest,cents,FACTORY } from '../../shared/incentives.mjs'
import { authedJson } from './transport'
import type { Deployment,Offer } from '../incentives/model'

type Authorization={quote:any;signature:Hex}
export function useDeploymentFlow(account:Address|null){
  const key='saffron.deployment-authorization.v1:'+account?.toLowerCase()
  const [saved,setSaved]=useState<Authorization|null>(()=>{try{const value=JSON.parse(localStorage.getItem(key)??'null');return value?.quote.wallet===account?.toLowerCase()?value:null}catch{return null}})
  const [quote,setQuote]=useState<any>(saved?.quote??null),[deployment,setDeployment]=useState<Deployment|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState<string>()
  function persist(value:Authorization|null){if(value)localStorage.setItem(key,JSON.stringify(value));else localStorage.removeItem(key);setSaved(value)}
  async function review(offer:Offer,amount:string){
    if(!account)return
    setBusy(true);setError(undefined)
    try{
      const {quote:q}=await authedJson(account,'/deployment-quotes',{programId:offer.id,amountUsd:amount})
      const expected=digest({snapshot:q.snapshot,plan:q.plan,signer:q.signer,programRevision:q.programRevision,pairRevision:q.pairRevision,budgetRevision:q.budgetRevision})
      if(q.origin!==location.origin||q.wallet!==account.toLowerCase()||q.programId!==offer.id||q.principalCents!==cents(amount)||expected!==q.planHash
        ||q.snapshot.poolAddress!==offer.pool||q.snapshot.variableAssetAddress!==offer.token0.address||q.snapshot.durationSeconds!==offer.days*86400
        ||q.snapshot.aprRaw!==BigInt(Math.round(offer.apr*100))*10n**14n+'')throw new Error('Deployment terms changed. Refresh the program before reviewing.')
      await assertWalletAccount(account);setQuote(q)
    }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  async function authorize(){
    if(!account||!quote)return
    setBusy(true);setError(undefined)
    try{
      let authorization=saved
      if(!authorization){
        if(Date.parse(quote.expiresAt)<=Date.now())throw new Error('Quote expired. Review a fresh quote.')
        await assertWalletAccount(account);await ensureChain(robinhoodChain)
        const signature=await walletClient().signTypedData({...deploymentTypedData(quote),account})
        await assertWalletAccount(account)
        authorization={quote,signature}
        // Durable before dispatch: a lost HTTP response retries this exact intent.
        persist(authorization)
      }
      const result=await authedJson(account,'/deployments',{quoteId:authorization.quote.id,signature:authorization.signature})
      setDeployment(result.deployment);persist(null);window.dispatchEvent(new Event('saffron:vault-updated'))
    }catch(cause){setError((cause as Error).message)}finally{setBusy(false)}
  }
  function reset(){if(saved)throw new Error('Resolve the saved authorization first.');setQuote(null);setDeployment(null);setError(undefined)}
  // Discard is safe only after the API has definitively rejected an unaccepted
  // quote. Otherwise use My vaults or retry the exact stored authorization.
  async function discardRejected(){if(!saved||!account)return;setBusy(true)
    try{const result=await authedJson(account,'/deployments',{quoteId:saved.quote.id,signature:saved.signature});setDeployment(result.deployment);persist(null)}
    catch(cause){if(/Quote expired|Program or funding policy changed|Funding capacity was taken/.test((cause as Error).message)){persist(null);setQuote(null)}else setError((cause as Error).message)}
    finally{setBusy(false)}}
  return {quote,deployment,saved,busy,error,review,authorize,reset,discardRejected}
}
