import { useEffect,useRef } from 'react'
import type { useDeploymentFlow } from '../host/useDeploymentFlow'
import { Elapsed } from './DeploymentWaiting'
import { Action,ErrorText,FinePrint,QuietButton,Stack } from './styles'
export function PaymentWaiting({flow}:{flow:ReturnType<typeof useDeploymentFlow>}){
  const latest=useRef(flow);latest.current=flow
  useEffect(()=>{
    let stopped=false,pending=false,failures=0,timer:ReturnType<typeof setTimeout>|undefined
    async function check(){
      if(stopped||pending)return
      clearTimeout(timer);pending=true
      if(!latest.current.busy){await latest.current.recover();failures=latest.current.error?failures+1:0}
      pending=false;if(!stopped)timer=setTimeout(()=>void check(),Math.min(30000,5000*2**Math.min(failures,3)))
    }
    const foreground=()=>{if(!document.hidden)void check()}
    void check();window.addEventListener('focus',foreground);document.addEventListener('visibilitychange',foreground)
    return()=>{stopped=true;clearTimeout(timer);window.removeEventListener('focus',foreground);document.removeEventListener('visibilitychange',foreground)}
  },[flow.saved?.quote.id])
  const state=flow.saved?.resolutionState,refunded=state==='refunded'
  const label=refunded?'Refund confirmed':state==='refund_due'?'Refund pending':state==='confirming'?'Refund confirming':state==='needs_attention'||state==='reconciliation_required'?'Payment received · waiting for operator review':flow.saved?.status==='submitting'?'Waiting for wallet confirmation':'Confirming your creation payment'
  return <Stack data-payment-waiting><b role='status' aria-live='polite'>{label}</b>
    <Elapsed since={flow.quote?.issuedAt}/>
    <FinePrint>Your request is saved. You can close this window and resume it later. Do not send another creation fee.</FinePrint>
    {flow.saved?.hash&&<a href={'https://robinhoodchain.blockscout.com/tx/'+flow.saved.hash} target='_blank' rel='noreferrer'>Payment transaction ↗</a>}
    {flow.error&&<ErrorText role='alert'>{flow.error}</ErrorText>}
    {!refunded&&<><label>Existing payment transaction hash<input aria-label='Payment transaction hash' value={flow.recoveryHash} onChange={e=>flow.setRecoveryHash(e.target.value)}/></label>
      <Action disabled={flow.busy} onClick={()=>void flow.pay()}>{flow.busy?'Checking payment…':'Check payment'}</Action></>}
    {refunded&&<QuietButton disabled={flow.busy} onClick={()=>void flow.reset()}>Finish refund review</QuietButton>}
  </Stack>
}
