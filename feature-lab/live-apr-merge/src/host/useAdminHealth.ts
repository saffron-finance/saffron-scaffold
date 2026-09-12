import { useCallback,useState } from 'react'
import type { Address } from 'viem'
import { ensureOperatorSession,readSession,requestJson } from './transport'
import { usePollingResource } from './usePollingResource'

export type HealthState='ready'|'blocked'|'warning'|'unknown'|'manual'
export type HealthCheck={id:string;title:string;state:HealthState;detail:string;owner:string;action:string;scope:string}
export type AdminHealth={checkedAt:string;canQuote:boolean|null;mode:string|null;checks:HealthCheck[];readiness:any;metrics:any;signer:Address|null;feeRecipient:Address|null;heartbeatAt:string|null;watcherId:string;watcherCheckedAt:string|null}

/** Authenticate with the existing wallet session. A failed health request keeps
 * sign-in state, not a fabricated healthy report or zero-valued counters. */
export function useAdminHealth(account:Address|null){
  const [busy,setBusy]=useState(false),[signError,setSignError]=useState('')
  const load=useCallback(async(signal:AbortSignal)=>{
    if(!account)return {session:null,report:null as AdminHealth|null,unavailable:false}
    const session=await readSession(account,signal)
    if(!session?.operator)return {session,report:null as AdminHealth|null,unavailable:false}
    try{
      const report=await requestJson('/admin/health',undefined,signal)
      if(!Array.isArray(report.checks)||!report.checkedAt)throw new Error('Invalid status report')
      return {session,report:report as AdminHealth,unavailable:false}
    }catch{return {session,report:null as AdminHealth|null,unavailable:true}}
  },[account])
  const poll=usePollingResource('admin-health:'+account,load,'saffron:session,saffron:catalog-updated,saffron:intake-updated')
  async function signIn(){if(!account)return;setBusy(true);setSignError('');try{await ensureOperatorSession(account);poll.refresh()}catch(e){setSignError((e as Error).message)}finally{setBusy(false)}}
  return {report:poll.data?.report??null,session:poll.data?.session??null,unavailable:Boolean(poll.error||poll.data?.unavailable),loading:poll.loading,busy,signError,signIn,refresh:poll.refresh}
}
