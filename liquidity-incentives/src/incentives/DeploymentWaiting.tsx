import { useEffect,useState } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { useDeploymentStatus } from '../host/useDeploymentStatus'
import { VaultLifecyclePanel } from './VaultLifecyclePanel'
import { statusLabel } from './model'
import { Action,Disclosure,ErrorText,FinePrint,QuietButton,Stack } from './styles'

export function Elapsed({since}:{since?:string}){
  const [now,setNow]=useState(Date.now)
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[])
  const elapsed=since?Math.max(0,Math.floor((now-Date.parse(since))/1000)):0
  return <FinePrint aria-live='off'>Elapsed <time aria-label='Time since request'>{Math.floor(elapsed/3600)>0?Math.floor(elapsed/3600)+'h ':''}{Math.floor(elapsed/60)%60}m {elapsed%60}s</time></FinePrint>
}
export function DeploymentWaiting({account,id,position,onPosition,onBusy}:{account:Address;id:string;position:boolean;onPosition:()=>void;onBusy:(busy:boolean)=>void}){
  const status=useDeploymentStatus(account,id),row=status.data,progress=row?.progress
  const [busy,setBusy]=useState(false),[error,setError]=useState('')
  useEffect(()=>onBusy(busy),[busy,onBusy])
  if(position)return <VaultLifecyclePanel account={account} id={id} onBusy={onBusy} row={row} verificationError={status.error}/>
  const reason=status.error?'verification_unavailable':progress?.reason
  const label=reason==='queued'?'Your request is queued':reason==='awaiting_funding'?'Awaiting campaign funding':reason==='operator_review'?'Waiting for operator review'
    :reason==='verification_unavailable'?'Verification temporarily unavailable':reason==='ready'?(row?.state==='occupied'?'Fixed side occupied':'Your vault is ready')
    :reason?.startsWith('payment_')?statusLabel(reason.slice(8)):reason==='retired'?'Historical request':reason==='retirement_requested'?'Needs operator attention'
    :progress?.activeStage===1?'Preparing your vault':progress?.activeStage===2?'Creating your vault':progress?.activeStage===3?'Checking your vault':'Loading your request…'
  return <Stack data-vault-lifecycle={id} data-deployment-waiting>
    <b role='status' aria-live='polite'>{label}</b><Elapsed since={progress?.requestedAt??row?.createdAt}/>
    <FinePrint>You can close this window and return through My requests. Your request remains saved.</FinePrint>
    {progress&&<Stages aria-label='Vault creation progress'>{progress.stages.map(stage=><li key={stage.id} aria-current={stage.state==='active'?'step':undefined}>
      <StageMarker $active={stage.state==='active'&&reason!=='verification_unavailable'} $complete={stage.state==='complete'} aria-hidden='true'>{stage.state==='complete'?'✓':stage.id}</StageMarker>
      <span>{stage.name}<small>{{complete:'Complete',active:'In progress',pending:'Pending',blocked:'On hold',checking:'Checking'}[stage.state]}</small></span>
    </li>)}</Stages>}
    {progress?.lastProgressAt&&<FinePrint>Last verified progress: {new Date(progress.lastProgressAt).toLocaleString()}{progress.observedBlock?' · block '+progress.observedBlock.number:''}.</FinePrint>}
    {progress?.serviceWindowMinutes&&<FinePrint>Operator service window: {progress.serviceWindowMinutes} minutes. This is an operational window; funding and chain confirmations may take longer.</FinePrint>}
    {reason==='awaiting_funding'&&<FinePrint>Your vault has been created. The campaign operator must fund the entire premium before you can deposit LP assets.</FinePrint>}
    {progress?.operatorAction&&<FinePrint>The operator is reviewing this saved request. Do not submit another creation payment.</FinePrint>}
    {status.error&&<ErrorText role='alert'>The last known request is shown. Verification is unavailable and new actions are paused.</ErrorText>}
    {error&&<ErrorText role='alert'>{error}</ErrorText>}
    {row&&(row.depositable||row.canClaim||row.canWithdraw||row.canRecover)&&<Action disabled={Boolean(status.error)||busy} onClick={onPosition}>{row.depositable?'Deposit LP assets':'View position'}</Action>}
    <QuietButton onClick={status.refresh}>Check progress</QuietButton>
    {row?.transactions.length?<Disclosure><summary>Deployment transactions</summary>{row.transactions.map(tx=><p key={tx.hash}><a target='_blank' rel='noreferrer' href={'https://robinhoodchain.blockscout.com/tx/'+tx.hash}>{tx.step.replaceAll('-',' ')} · {tx.confirmed?'confirmed':tx.reverted?'failed':'checking'} ↗</a></p>)}</Disclosure>:null}
  </Stack>
}
const Stages=styled.ol`list-style:none;padding:0;margin:4px 0;display:flex;flex-direction:column;gap:18px;li{display:flex;align-items:center;gap:14px;font-size:14px;}small{display:block;color:#999;margin-top:4px;font-size:12px;}`
const StageMarker=styled.span<{$active:boolean;$complete:boolean}>`position:relative;display:grid;place-items:center;flex:0 0 32px;height:32px;border:1px solid ${({$complete,$active})=>$complete||$active?'#ffbc09':'#555'};border-radius:50%;color:${({$complete,$active})=>$complete||$active?'#ffbc09':'#999'};
  &::after{content:'';position:absolute;inset:-4px;border:2px solid transparent;border-top-color:${({$active})=>$active?'#ffbc09':'transparent'};border-radius:50%;animation:${({$active})=>$active?'request-spin 1.5s linear infinite':'none'};}
  @keyframes request-spin{to{transform:rotate(360deg)}}@media(prefers-reduced-motion:reduce){&::after{animation:none;}}`
