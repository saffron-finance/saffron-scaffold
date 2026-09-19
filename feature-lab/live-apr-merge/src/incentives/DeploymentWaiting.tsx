import { formatUnits } from 'viem'
import { useEffect,type ReactNode } from 'react'
import type { Address } from 'viem'
import styled,{keyframes} from 'styled-components'
import { useDeploymentStatus } from '../host/useDeploymentStatus'
import { VaultLifecyclePanel } from './VaultLifecyclePanel'
import { statusLabel,type Deployment } from './model'
import { Action,Disclosure,ErrorText,FinePrint,QuietButton,Stack } from './styles'

export function DeploymentWaiting({account,id,position,onPosition,onBusy,onDeployment}:{account:Address;id:string;position:boolean;onPosition:()=>void;onBusy:(busy:boolean)=>void;onDeployment?:(row:Deployment)=>void}){
  const status=useDeploymentStatus(account,id),row=status.data,progress=row?.progress
  useEffect(()=>{if(!position)onBusy(false)},[position,onBusy])
  useEffect(()=>{if(row)onDeployment?.(row)},[row,onDeployment])
  if(position)return <VaultLifecyclePanel account={account} id={id} onBusy={onBusy} row={row} verificationError={status.error}/>
  const reason=status.error?'verification_unavailable':progress?.reason
  const label=row?.refund?statusLabel(row.refund.state):reason==='queued'?'Your request is queued':reason==='awaiting_funding'?'Verifying vault':reason==='operator_review'?'Waiting for operator review'
    :reason==='verification_unavailable'?'Verification temporarily unavailable':reason==='ready'?(row?.state==='occupied'?'Fixed side occupied':'Your vault is ready')
    :reason?.startsWith('payment_')?statusLabel(reason.slice(8)):reason==='retired'?'Historical request':reason==='retirement_requested'?'Needs operator attention'
    :progress?.activeStage===1?'Preparing your vault':progress?.activeStage===2?'Creating your vault':progress?.activeStage===3?'Checking your vault':progress?.activeStage===4?'Verifying vault':'Loading your request…'
  return <Stack data-vault-lifecycle={id} data-deployment-waiting>
    <RequestPending label={label} active={!row?.refund&&!['ready','retired','retirement_requested','verification_unavailable'].includes(reason??'')}>
      {row?.refund&&<FinePrint>{row.refund.state==='refunded'?'Your original creation fee has been repaid on Robinhood and this request is closed.':row.refund.state==='refund_exception'?'The refund needs canonical verification again. Creation remains stopped.':'The operator cannot fulfill this request and has approved repayment of your original creation fee. Creation is stopped.'} {formatUnits(BigInt(row.refund.verifiedWei),18)} / {formatUnits(BigInt(row.refund.amountWei),18)} ETH verified.</FinePrint>}
      {reason==='awaiting_funding'&&<FinePrint>Your vault has been created. The incentive program operator must fund the entire premium before you can deposit LP assets.</FinePrint>}
      {progress?.operatorAction&&!row?.refund&&<FinePrint>The operator is reviewing this saved request. Do not submit another creation payment.</FinePrint>}
      <FinePrint>You can close this window and return through Portfolio. Your request remains saved.</FinePrint>
    </RequestPending>
    {progress?.paymentState==='sample'&&<FinePrint>Sample request progress · no onchain transactions.</FinePrint>}
    {status.error&&<ErrorText role='alert'>The last known request is shown. Verification is unavailable and new actions are paused.</ErrorText>}
    {row&&(row.depositable||row.canClaim||row.canWithdraw||row.canRecover)&&<Action disabled={Boolean(status.error)} onClick={onPosition}>{row.depositable?'Deposit LP assets':'View position'}</Action>}
    {/* Always available, even before the first transaction, so manual refresh
        and status evidence are not lost when the journal is initially empty. */}
    <Disclosure data-deployment-transactions><summary>Deployment transactions</summary><TransactionDetails>
      {(progress?.requestedAt??row?.createdAt)&&<FinePrint>Requested: {new Date(progress?.requestedAt??row!.createdAt).toLocaleString()}.</FinePrint>}
      {progress?.lastProgressAt&&<FinePrint>Last verified progress: {new Date(progress.lastProgressAt).toLocaleString()}{progress.observedBlock?' · block '+progress.observedBlock.number:''}.</FinePrint>}
      {progress?.serviceWindowMinutes&&<FinePrint>Operator service window: {progress.serviceWindowMinutes} minutes. This is an operational window; funding and chain confirmations may take longer.</FinePrint>}
      <QuietButton onClick={status.refresh}>Check progress</QuietButton>
      {row?.transactions.map(tx=><p key={tx.hash}><a target='_blank' rel='noreferrer' href={'https://robinhoodchain.blockscout.com/tx/'+tx.hash}>{tx.step.replaceAll('-',' ')} · {tx.confirmed?'confirmed':tx.reverted?'failed':'checking'} ↗</a></p>)}
    </TransactionDetails></Disclosure>
  </Stack>
}
const TransactionDetails=styled(Stack)`margin-top:16px;gap:14px;p{margin:0;}`

/** One presentation for payment preparation and saved-request progression.
 * Labels come from real flow/status state; completed or unavailable requests
 * stop animating instead of implying that work is still progressing. */
export function RequestPending({label,active=true,children}:{label:string;active?:boolean;children?:ReactNode}){
  return <Pending data-request-pending><Spinner data-request-spinner data-spinning={active} $active={active} aria-hidden='true'/><b role='status' aria-live='polite' aria-atomic='true'>{label}</b>{children}</Pending>
}
const spin=keyframes`to{transform:rotate(360deg)}`
const Pending=styled.div`display:flex;flex-direction:column;align-items:center;gap:16px;padding:24px 0;text-align:center;`
const Spinner=styled.span<{$active:boolean}>`width:28px;height:28px;border:3px solid #493353;border-top-color:#d286ff;border-radius:50%;animation:${spin} .8s linear infinite;animation-play-state:${p=>p.$active?'running':'paused'};@media(prefers-reduced-motion:reduce){animation:none;}`
