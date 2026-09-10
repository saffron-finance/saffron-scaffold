import { createPublicClient,http,type Address } from 'viem'
import { robinhoodChain } from '@lab/chain/chains'
import { assertWalletAccount,walletClient } from '@lab/wallet/wallet'
import { walletSessionMessage } from '../../shared/incentives.mjs'

export const BASE=import.meta.env.BASE_URL.replace(/\/$/,'')
export const apiUrl=(path='')=>BASE+'/api/incentives'+path
export const robinhoodClient=createPublicClient({chain:robinhoodChain,transport:http(BASE+'/rpc/robinhood',{batch:true,timeout:15_000})})
export type WalletSession={wallet:Address;csrf:string;operator:boolean;expires:number}
let viewerWallet:Address|null=null
let session:WalletSession|null=null
export const paymentSessionKey=(account:string)=>'saffron.payment-session.v1:'+account.toLowerCase()
export function rememberPayment(account:Address,proof:object,current:WalletSession){localStorage.setItem(paymentSessionKey(account),JSON.stringify(proof));session=current;window.dispatchEvent(new Event('saffron:session'))}
let signing:Promise<WalletSession>|null=null
export async function requestJson(path:string,body?:object,signal?:AbortSignal){
  if(!body&&viewerWallet&&/^\/(deployments|positions)(\/|\?|$)/.test(path))path+=(path.includes('?')?'&':'?')+'wallet='+viewerWallet
  const response=await fetch(apiUrl(path),{cache:'no-store',credentials:'same-origin',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30_000)]):AbortSignal.timeout(30_000),
    ...(body?{method:'POST',headers:{'content-type':'application/json','x-saffron-csrf':session?.csrf??''},body:JSON.stringify(body)}:{})})
  const result=await response.json().catch(()=>null)
  if(!response.ok||!result){if(response.status===401)session=null;throw new Error(result?.error??'The application is unavailable. Your saved deployment can be resumed.')}
  return result
}
export async function readSession(account:Address|null){
  viewerWallet=account
  session=(await requestJson('/session')).session
  return session?.wallet.toLowerCase()===account?.toLowerCase()?session:null
}
export async function ensureOperatorSession(account:Address):Promise<WalletSession>{
  await assertWalletAccount(account)
  if(session?.wallet.toLowerCase()===account.toLowerCase()&&session.expires>Date.now()+5000)return session
  if(signing){await signing;return ensureOperatorSession(account)}
  signing=(async()=>{
    const proof=await requestJson('/session/challenge',{wallet:account})
    if(proof.origin!==location.origin||proof.wallet!==account.toLowerCase()||proof.chainId!==4663||Date.parse(proof.expiresAt)<=Date.now())throw new Error('Wallet sign-in challenge changed.')
    await assertWalletAccount(account)
    const signature=await walletClient().signMessage({account,message:walletSessionMessage(proof)})
    await assertWalletAccount(account)
    session=(await requestJson('/session/login',{wallet:account,nonce:proof.nonce,signature})).session
    if(!session||session.wallet!==account.toLowerCase())throw new Error('Wallet session changed.')
    window.dispatchEvent(new Event('saffron:session'));return session
  })().finally(()=>{signing=null})
  return signing
}
/** User sessions resume from a payment-bound private recovery capability;
 * there is never a message-signing fallback in the user flow. */
export async function ensureSession(account:Address):Promise<WalletSession>{
  viewerWallet=account
  if(session?.wallet.toLowerCase()===account.toLowerCase()&&session.expires>Date.now()+5000)return session
  const saved=JSON.parse(localStorage.getItem(paymentSessionKey(account))??'null')
  if(!saved)throw new Error('Open the original paid request to manage its deployment options.')
  session=(await requestJson('/session/payment',saved)).session
  if(!session||session.wallet!==account.toLowerCase())throw new Error('Payment session changed.')
  return session
}
export async function authedJson(account:Address,path:string,body?:object){await (path.startsWith('/admin/')?ensureOperatorSession(account):ensureSession(account));await assertWalletAccount(account);return requestJson(path,body)}
