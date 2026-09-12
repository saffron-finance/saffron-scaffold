import { useCallback,useEffect,useState } from 'react'
import type { Address } from 'viem'
import type { Deployment } from '../incentives/model'
import { readSession,ensureOperatorSession,requestJson,type WalletSession } from './transport'
import { usePollingResource } from './usePollingResource'

type OperatorStatus={signer:string;pending:number;stalled:number;workerOnline:boolean;readiness:any;metrics:any;alerts:{code:string;severity:string}[]}
type PageData={rows:Deployment[];session:WalletSession|null;online:boolean;operatorStatus:OperatorStatus|null;positionsUpdating:boolean;nextCursor:string|null;payments:any[];paymentNextCursor:string|null}
export function useDeployments(account:Address|null,admin=false){
  const [error,setError]=useState<string>(),[busy,setBusy]=useState(false)
  const [cursors,setCursors]=useState<(string|null)[]>([null])
  const [paymentCursors,setPaymentCursors]=useState<(string|null)[]>([null])
  const cursor=cursors.at(-1),paymentCursor=paymentCursors.at(-1)
  useEffect(()=>{setCursors([null]);setPaymentCursors([null])},[account,admin])
  const load=useCallback(async(signal:AbortSignal):Promise<PageData>=>{
    const session=await readSession(account,signal)
    const empty={rows:[],session,online:false,operatorStatus:null,positionsUpdating:false,nextCursor:null,payments:[],paymentNextCursor:null}
    if(!account||admin&&!session?.operator)return empty
    const path=(admin?'/admin/deployments':'/deployments')+(cursor?'?cursor='+encodeURIComponent(cursor):'')
    const [data,status,payments]=await Promise.all([requestJson(path,undefined,signal),admin?requestJson('/admin/status',undefined,signal):null,
      admin?null:requestJson('/payments?wallet='+account+(paymentCursor?'&cursor='+encodeURIComponent(paymentCursor):''),undefined,signal)])
    return {rows:data.deployments,session,online:data.creatorOnline,operatorStatus:status,positionsUpdating:data.positionsUpdating,nextCursor:data.nextCursor,payments:payments?.payments??[],paymentNextCursor:payments?.nextCursor??null}
  },[account,admin,cursor,paymentCursor])
  const poll=usePollingResource([account,admin,cursor,paymentCursor].join(':'),load,'saffron:vault-updated,saffron:session')
  const data=poll.data
  async function signIn(){if(!account)return;setBusy(true);setError(undefined);try{await ensureOperatorSession(account);poll.refresh()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  return {rows:data?.rows??[],session:data?.session??null,error:error??poll.error,busy,online:data?.online??false,operatorStatus:data?.operatorStatus??null,
    positionsUpdating:data?.positionsUpdating??false,payments:data?.payments??[],loading:poll.loading,refresh:poll.refresh,signIn,verificationUnavailable:Boolean(poll.error),
    page:cursors.length,hasNext:Boolean(data?.nextCursor),
    paymentPage:paymentCursors.length,hasNextPayments:Boolean(data?.paymentNextCursor),
    nextPayments:()=>{if(data?.paymentNextCursor&&!poll.loading)setPaymentCursors(value=>[...value,data.paymentNextCursor])},
    previousPayments:()=>{if(!poll.loading)setPaymentCursors(value=>value.length>1?value.slice(0,-1):value)},
    nextPage:()=>{if(data?.nextCursor&&!poll.loading)setCursors(value=>[...value,data.nextCursor])},
    previousPage:()=>{if(!poll.loading)setCursors(value=>value.length>1?value.slice(0,-1):value)}}
}
