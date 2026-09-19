import {programText} from '../incentives/program-language'
import { createClient,http,type Address } from 'viem'
import { catalogReadActions } from '@lab/wallet/uiActions'
import { robinhoodChain } from '@lab/chain/chains'
import { assertWalletAccount,walletClient } from '@lab/wallet/wallet'
import { walletSessionMessage } from '../../shared/incentives.mjs'

export const BASE=import.meta.env.BASE_URL.replace(/\/$/,'')
export const apiUrl=(path='')=>BASE+'/api/incentives'+path
export const robinhoodClient=createClient({key:'public',name:'Public Client',type:'publicClient',chain:robinhoodChain,transport:http(BASE+'/rpc/robinhood',{batch:true,timeout:15_000})}).extend(catalogReadActions)
/** Shared preview work gets its own abortable, non-retrying transport. It must
 * not inherit the long retry sequence used by unrelated background readers. */
export function createPriceReadClient(signal:AbortSignal){
  return createClient({key:'preview',name:'Price Preview',type:'publicClient',chain:robinhoodChain,
    // viem batches by URL/call-signal, not fetchOptions.signal. Keep these
    // owner-scoped reads separate from unrelated default-transport batches.
    transport:http(BASE+'/rpc/robinhood',{batch:false,timeout:30_000,retryCount:0,fetchOptions:{signal}})}).extend(catalogReadActions)
}
export type WalletSession={wallet:Address;csrf:string;operator:boolean;expires:number}
let viewerWallet:Address|null=null
let session:WalletSession|null=null
let authRevision=0
/** Viewer binding must not depend on whether a page happens to poll Portfolio. */
export function setViewerWallet(account:Address|null){
  if(viewerWallet?.toLowerCase()!==account?.toLowerCase()){viewerWallet=account;session=null;authRevision++}
}
/** Authentication writes supersede every earlier session discovery response. */
function saveSession(value:WalletSession|null){session=value;authRevision++;return value}
let sessionRead:{key:string;revision:number;promise:Promise<WalletSession|null>}|null=null
export const paymentSessionKey=(account:string)=>'saffron.payment-session.v1:'+account.toLowerCase()
export function rememberPayment(account:Address,proof:object,current:WalletSession){localStorage.setItem(paymentSessionKey(account),JSON.stringify(proof));if(viewerWallet?.toLowerCase()===account.toLowerCase())saveSession(current);window.dispatchEvent(new Event('saffron:session'))}
let signing:Promise<WalletSession>|null=null
export async function requestJson(path:string,body?:object,signal?:AbortSignal){
  if(!body&&viewerWallet&&/^\/(deployments|positions)(\/|\?|$)/.test(path)&&!new URLSearchParams(path.split('?')[1]).has('wallet'))path+=(path.includes('?')?'&':'?')+'wallet='+viewerWallet
  const requestRevision=authRevision
  const response=await fetch(apiUrl(path),{cache:'no-store',credentials:'same-origin',signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30_000)]):AbortSignal.timeout(30_000),
    ...(body?{method:'POST',headers:{'content-type':'application/json','x-saffron-csrf':session?.csrf??''},body:JSON.stringify(body)}:{})})
  const result=await response.json().catch(()=>null)
  // Wallet expiry is a typed 403 behind Basic Auth. Ordinary permission/CSRF
  // failures must not clear a valid session, nor may an older request clear a new one.
  if(!response.ok||!result){if((response.status===401||(response.status===403&&result?.code==='wallet_session_required'))&&requestRevision===authRevision)saveSession(null);throw new Error(programText(result?.error??'The application is unavailable. Your saved deployment can be resumed.'))}
  return result
}
/** Coalesce discovery reads but allow each consumer to leave independently.
 * New authentication/viewer generations cannot be overwritten by old reads. */
export async function readSession(account:Address|null,signal?:AbortSignal){
  setViewerWallet(account)
  const key=account?.toLowerCase()??'',revision=authRevision
  const current=()=>session?.wallet.toLowerCase()===key?session:null
  if(!sessionRead||sessionRead.key!==key||sessionRead.revision!==revision){
    const entry={key,revision,promise:Promise.resolve(null) as Promise<WalletSession|null>}
    entry.promise=requestJson('/session').then(result=>{
      if(authRevision===revision&&viewerWallet?.toLowerCase()===(account?.toLowerCase())){
        session=result.session?.wallet.toLowerCase()===key?result.session:null
      }
      return current()
    }).catch(error=>{if(authRevision!==revision)return current();throw error})
      .finally(()=>{if(sessionRead===entry)sessionRead=null})
    sessionRead=entry
  }
  const shared=sessionRead.promise
  if(!signal)return shared
  return new Promise<WalletSession|null>((resolve,reject)=>{
    const abort=()=>reject(new DOMException('Session read cancelled','AbortError'))
    signal.addEventListener('abort',abort,{once:true})
    if(signal.aborted)abort()
    shared.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort))
  })
}
export async function ensureOperatorSession(account:Address):Promise<WalletSession>{
  setViewerWallet(account)
  await assertWalletAccount(account)
  if(session?.wallet.toLowerCase()===account.toLowerCase()&&session.expires>Date.now()+5000)return session
  if(signing){await signing;return ensureOperatorSession(account)}
  signing=(async()=>{
    const proof=await requestJson('/session/challenge',{wallet:account})
    if(proof.origin!==location.origin||proof.wallet!==account.toLowerCase()||proof.chainId!==4663||Date.parse(proof.expiresAt)<=Date.now())throw new Error('Wallet sign-in challenge changed.')
    await assertWalletAccount(account)
    const signature=await walletClient().signMessage({account,message:walletSessionMessage(proof)})
    await assertWalletAccount(account)
    saveSession((await requestJson('/session/login',{wallet:account,nonce:proof.nonce,signature})).session)
    if(!session||session.wallet!==account.toLowerCase())throw new Error('Wallet session changed.')
    window.dispatchEvent(new Event('saffron:session'));return session
  })().finally(()=>{signing=null})
  return signing
}
/** User sessions resume from a payment-bound private recovery capability;
 * there is never a message-signing fallback in the user flow. */
export async function ensureSession(account:Address):Promise<WalletSession>{
  setViewerWallet(account)
  if(session?.wallet.toLowerCase()===account.toLowerCase()&&session.expires>Date.now()+5000)return session
  const saved=JSON.parse(localStorage.getItem(paymentSessionKey(account))??'null')
  if(!saved)throw new Error('Open the original paid request to manage its deployment options.')
  saveSession((await requestJson('/session/payment',saved)).session)
  if(!session||session.wallet!==account.toLowerCase())throw new Error('Payment session changed.')
  return session
}
export async function authedJson(account:Address,path:string,body?:object){await (path.startsWith('/admin/')?ensureOperatorSession(account):ensureSession(account));await assertWalletAccount(account);return requestJson(path,body)}
