import { useCallback,useEffect,useState } from 'react'
import type { Address } from 'viem'
import type { Deployment } from '../incentives/model'
import { readSession,ensureOperatorSession,requestJson } from './transport'
import { usePollingResource } from './usePollingResource'

type Rows={deployments:Deployment[];creatorOnline:boolean;positionsUpdating:boolean;nextCursor:string|null}
type Payments={payments:any[];nextCursor:string|null}
const emptyRows:Rows={deployments:[],creatorOnline:false,positionsUpdating:false,nextCursor:null}
const emptyPayments:Payments={payments:[],nextCursor:null}
const events='saffron:vault-updated,saffron:session'

/** Vaults, payment history and session discovery have independent lifetimes.
 * A slow auxiliary read never hides healthy rows or disables position actions.
 * The server authenticates admin requests; no preliminary status call is needed. */
export function useDeployments(account:Address|null,admin=false){
  const [error,setError]=useState<string>(),[busy,setBusy]=useState(false)
  const [cursors,setCursors]=useState<(string|null)[]>([null])
  const [paymentCursors,setPaymentCursors]=useState<(string|null)[]>([null])
  const cursor=cursors.at(-1),paymentCursor=paymentCursors.at(-1)
  useEffect(()=>{setCursors([null]);setPaymentCursors([null]);setError(undefined)},[account,admin])
  const loadSession=useCallback((signal:AbortSignal)=>account?readSession(account,signal):Promise.resolve(null),[account])
  const loadRows=useCallback((signal:AbortSignal):Promise<Rows>=>{
    if(!account)return Promise.resolve(emptyRows)
    // Bind the viewer explicitly: session discovery may still be in flight.
    const query=new URLSearchParams(admin?{}:{wallet:account})
    if(cursor)query.set('cursor',cursor)
    return requestJson((admin?'/admin/deployments':'/deployments')+(query.size?'?'+query:''),undefined,signal)
  },[account,admin,cursor])
  const loadPayments=useCallback((signal:AbortSignal):Promise<Payments>=>{
    if(!account||admin)return Promise.resolve(emptyPayments)
    const query=new URLSearchParams({wallet:account})
    if(paymentCursor)query.set('cursor',paymentCursor)
    return requestJson('/payments?'+query,undefined,signal)
  },[account,admin,paymentCursor])
  const session=usePollingResource('session:'+account,loadSession,events)
  const rows=usePollingResource([account,admin,cursor].join(':'),loadRows,events)
  const payments=usePollingResource([account,admin,paymentCursor].join(':'),loadPayments,events)
  const refresh=useCallback(()=>{rows.refresh();payments.refresh();session.refresh()},[rows.refresh,payments.refresh,session.refresh])
  async function signIn(){if(!account)return;setBusy(true);setError(undefined);try{await ensureOperatorSession(account);refresh()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  return {rows:rows.data?.deployments??[],session:session.data,error:error??rows.error,busy,online:rows.data?.creatorOnline??false,
    positionsUpdating:rows.data?.positionsUpdating??false,payments:payments.data?.payments??[],loading:rows.loading,refresh,signIn,
    verificationUnavailable:Boolean(rows.error),paymentError:payments.error,sessionError:session.error,paymentsLoading:payments.loading,
    page:cursors.length,hasNext:Boolean(rows.data?.nextCursor),
    paymentPage:paymentCursors.length,hasNextPayments:Boolean(payments.data?.nextCursor),
    nextPayments:()=>{if(payments.data?.nextCursor&&!payments.loading)setPaymentCursors(value=>[...value,payments.data!.nextCursor])},
    previousPayments:()=>{if(!payments.loading)setPaymentCursors(value=>value.length>1?value.slice(0,-1):value)},
    nextPage:()=>{if(rows.data?.nextCursor&&!rows.loading)setCursors(value=>[...value,rows.data!.nextCursor])},
    previousPage:()=>{if(!rows.loading)setCursors(value=>value.length>1?value.slice(0,-1):value)}}
}
