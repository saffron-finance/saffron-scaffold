import {useEffect,useRef,useState} from 'react'
import type {Address} from 'viem'
import {authedJson} from '../host/transport'
import {statusLabel} from './model'
import {Disclosure,ErrorText,FinePrint,QuietButton,Row} from './styles'

type Policy={signer:Address;revision:number;mode:'automatic'|'reviewed';enabled:boolean;expiresAt:string|null;serviceMinutes:number;watcherId:string}
type Fields={mode:Policy['mode'];minutes:string;serviceMinutes:string;watcherId:string}
type Draft={base:Policy;fields:Fields}
type Props={account:Address;status:any;onUpdate:()=>void}
const conflictMessage='Intake policy changed elsewhere. Saving is blocked to protect the newer settings. Load latest settings and review them before saving again.'

/** Normalize the saved policy as one immutable edit base. Defaults are only
 * for a confirmed absent policy, never missing fields in an existing policy. */
function savedPolicy(status:any):Policy|null{
  // Health and status endpoints may serialize the same address with different
  // casing. Normalize identities/timestamps before comparing saved snapshots.
  const signer=(typeof status?.signer==='string'?status.signer.toLowerCase():undefined) as Address|undefined,policy=status?.readiness?.policy
  if(!/^0x[0-9a-f]{40}$/i.test(signer??''))return null
  if(!signer)return null
  if(policy===null){
    const watcherId=status.watcherId??'native-eth-v1'
    return typeof watcherId==='string'&&/^[-a-z0-9]{1,64}$/.test(watcherId)
      ?{signer,revision:0,mode:'automatic',enabled:false,expiresAt:null,serviceMinutes:240,watcherId}:null
  }
  if(!policy||typeof policy.signer!=='string'||policy.signer.toLowerCase()!==signer||!Number.isSafeInteger(policy.revision)||policy.revision<1
    ||!['automatic','reviewed'].includes(policy.mode)||typeof policy.enabled!=='boolean'||!Number.isFinite(Date.parse(policy.expires_at))
    ||!Number.isInteger(policy.service_minutes)||policy.service_minutes<1||policy.service_minutes>1440||typeof policy.watcher_id!=='string'||!/^[-a-z0-9]{1,64}$/.test(policy.watcher_id))return null
  return{signer,revision:policy.revision,mode:policy.mode,enabled:policy.enabled,expiresAt:new Date(policy.expires_at).toISOString(),
    serviceMinutes:policy.service_minutes,watcherId:policy.watcher_id}
}

/** The window is a duration for the next opening. Existing live windows start
 * with their remaining minutes; expired windows require an explicit duration. */
function editPolicy(base:Policy):Draft{
  const remaining=base.expiresAt?Math.ceil((Date.parse(base.expiresAt)-Date.now())/60000):60
  return{base,fields:{mode:base.mode,minutes:remaining>0?String(Math.min(1440,remaining)):'',
    serviceMinutes:String(base.serviceMinutes),watcherId:base.watcherId}}
}
const samePolicy=(a:Policy,b:Policy)=>JSON.stringify(a)===JSON.stringify(b)
const validMinutes=(value:string)=>/^\d+$/.test(value)&&Number(value)>=1&&Number(value)<=1440

/** A wallet/signer change creates a separate editing session. Health refreshes
 * deliberately do NOT remount by revision or replace unsaved field values. */
export function IntakePolicy(props:Props){
  return <IntakePolicyEditor key={props.account.toLowerCase()+':'+String(props.status?.signer??'').toLowerCase()} {...props}/>
}

/** Optimistic concurrency: fields and the original revision travel together.
 * Keep a monotonic observed snapshot so delayed polling cannot erase a conflict
 * or roll back the authoritative response of a successful save. */
function IntakePolicyEditor({account,status,onUpdate}:Props){
  const incoming=savedPolicy(status)
  const latest=useRef<Policy|null>(incoming)
  if(incoming&&(!latest.current||incoming.revision>=latest.current.revision))latest.current=incoming
  const [draft,setDraft]=useState<Draft|null>(()=>incoming?editPolicy(incoming):null)
  const [error,setError]=useState(''),[needsReload,setNeedsReload]=useState(false),[busy,setBusy]=useState(false)
  const pending=useRef(false),mounted=useRef(true)
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[])
  useEffect(()=>{if(!draft&&incoming)setDraft(editPolicy(incoming))},[draft,incoming?.revision])
  const changed=Boolean(draft&&latest.current&&!samePolicy(latest.current,draft.base))
  const conflict=changed||needsReload
  const fields=draft?.fields
  const valid=Boolean(fields&&validMinutes(fields.minutes)&&validMinutes(fields.serviceMinutes)&&/^[-a-z0-9]{1,64}$/.test(fields.watcherId))
  const unavailable=!incoming||!draft
  const readiness=status.readiness,policy=latest.current

  function edit<K extends keyof Fields>(name:K,value:Fields[K]){
    setDraft(previous=>previous?{...previous,fields:{...previous.fields,[name]:value}}:null)
  }

  /** Loading is explicitly destructive to local edits, never a save/retry. A
   * single manual GET is enough; the existing health poll remains unchanged. */
  async function reload(){
    if(pending.current)return
    pending.current=true;setBusy(true);setError('')
    try{
      const result=await authedJson(account,'/admin/status'),saved=savedPolicy(result)
      if(!mounted.current)return
      if(!saved||saved.signer.toLowerCase()!==status.signer.toLowerCase()||latest.current&&saved.revision<latest.current.revision)throw new Error('Latest intake settings could not be verified. Refresh again before saving.')
      latest.current=saved;setDraft(editPolicy(saved));setNeedsReload(false);onUpdate()
    }catch(cause){if(mounted.current)setError(cause instanceof Error?cause.message:'Could not load intake settings.')}
    finally{pending.current=false;if(mounted.current)setBusy(false)}
  }

  async function save(enabled:boolean){
    if(pending.current||!draft||!incoming)return
    // This check catches already-observed edits. The captured revision below
    // also lets the backend reject races not yet visible in the health poll.
    if(needsReload||!latest.current||!samePolicy(latest.current,draft.base)){setError(conflictMessage);return}
    if(enabled&&!valid)return
    const {base,fields}=draft
    pending.current=true;setBusy(true);setError('')
    try{
      const expiresAt=enabled?new Date(Date.now()+Number(fields.minutes)*60000).toISOString()
        // Pause must not apply draft fields or renew an active window. The
        // legacy API requires a future expiry even for an already-expired pause.
        :base.expiresAt&&Date.parse(base.expiresAt)>Date.now()?base.expiresAt:new Date(Date.now()+60000).toISOString()
      const result=await authedJson(account,'/admin/intake',{signer:base.signer,revision:base.revision,enabled,expiresAt,
        mode:enabled?fields.mode:base.mode,serviceMinutes:enabled?Number(fields.serviceMinutes):base.serviceMinutes,
        watcherId:enabled?fields.watcherId:base.watcherId})
      if(!mounted.current)return
      const saved=savedPolicy({signer:base.signer,readiness:{policy:result.policy}})
      if(!saved||saved.revision!==base.revision+1)throw new Error('Save result could not be verified. Load latest settings before saving again.')
      // A newer report may have arrived while saving. Retain it as a conflict;
      // never silently merge its revision into the just-submitted draft.
      if(!latest.current||saved.revision>=latest.current.revision)latest.current=saved
      setDraft(editPolicy(saved));setNeedsReload(false);onUpdate()
    }catch(cause){
      if(mounted.current){
        const message=cause instanceof Error?cause.message:'Intake save failed.'
        setNeedsReload(true);setError(/Intake policy changed/i.test(message)?conflictMessage:message)
        onUpdate() // A lost response can still mean the server saved the policy.
      }
    }finally{pending.current=false;if(mounted.current)setBusy(false)}
  }

  return <Disclosure id='intake-controls'><summary>Edit intake window</summary>
    <FinePrint>{readiness?.mode==='reviewed'?'Reviewed one-request execution':'Automatic queue execution'}. {readiness?.reasons?.map(statusLabel).join(' · ')}. Signer process: {readiness?.workerOnline?'online':'offline'}. Watcher lag: {readiness?.watcher?.lagBlocks??'unavailable'} blocks.</FinePrint>
    {policy?.expiresAt&&<FinePrint>Intake expires {new Date(policy.expiresAt).toLocaleString()}. Declared service window: {policy.serviceMinutes} minutes.</FinePrint>}
    {draft&&<FinePrint>Editing saved revision {draft.base.revision}.</FinePrint>}
    {unavailable&&<ErrorText role='alert'>Saved intake settings are unavailable. Load latest settings before editing.</ErrorText>}
    {conflict&&<div role='alert' style={{border:'1px solid #ffbc09',borderRadius:8,padding:12,color:'#edcc83'}}>{changed||/Intake policy changed/.test(error)?conflictMessage:'The save result is uncertain. Load latest settings before saving again.'}</div>}
    <fieldset disabled={busy||unavailable} style={{border:0,padding:0,margin:0,display:'grid',gap:12,minWidth:0}}>
      <label>Execution mode<select value={fields?.mode??''} onChange={e=>edit('mode',e.target.value as Fields['mode'])}><option value='automatic'>Automatic queue</option><option value='reviewed'>Reviewed one-request</option></select></label>
      <label>Intake window (minutes, at most 1440)<input type='number' min='1' max='1440' value={fields?.minutes??''} placeholder='Enter duration' onChange={e=>edit('minutes',e.target.value)}/></label>
      <label>Declared service window (minutes)<input type='number' min='1' max='1440' value={fields?.serviceMinutes??''} onChange={e=>edit('serviceMinutes',e.target.value)}/></label>
      <label>Payment watcher ID<input value={fields?.watcherId??''} onChange={e=>edit('watcherId',e.target.value)}/></label>
    </fieldset>
    <Row><QuietButton disabled={busy||unavailable||conflict||!valid} onClick={()=>void save(true)}>Open intake window</QuietButton><QuietButton disabled={busy||unavailable||conflict||!draft?.base.enabled} onClick={()=>void save(false)}>Pause new requests</QuietButton></Row>
    <QuietButton disabled={busy} onClick={()=>void reload()}>Load latest settings</QuietButton>
    <FinePrint>Loading latest settings replaces your unsaved edits. Review them before saving. Opening intake enables quotes only when the watcher and admission checks pass; it does not start the signer.</FinePrint>
    {error&&error!==conflictMessage&&<ErrorText role='alert'>{error}</ErrorText>}
  </Disclosure>
}
