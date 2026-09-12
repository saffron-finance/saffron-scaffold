import { useCallback } from 'react'
import { requestJson } from '../host/transport'
import { usePollingResource } from '../host/usePollingResource'
import type { Payment } from '../host/payment-records.mjs'
import { formatUnits,type Address } from 'viem'
import { StepTitle } from '../host/ui'
import type { useDeployments } from '../host/useDeployments'
import { statusLabel } from './model'
import { DeploymentPagination } from './DeploymentPagination'
import { Action,ErrorText,FinePrint,QuietButton,Row,Stack } from './styles'

export function MyVaults({account,positions,onConnect,onOpen,onBack,onAdmin,payments,onResumePayment}:{account:Address|null;positions:ReturnType<typeof useDeployments>;onConnect:()=>void;onOpen:(id:string,position?:boolean)=>void;onBack:()=>void;onAdmin:()=>void;payments:Payment[];onResumePayment:(id:string)=>void}){
  return <Stack><Row><StepTitle>Portfolio</StepTitle><QuietButton onClick={onBack}>Home</QuietButton></Row>
    {!account?<Action onClick={onConnect}>Connect wallet</Action>:<>
      {positions.session?.operator&&<PortfolioCapacity/>}
      {payments.map(payment=><Row key={payment.quote.id}><FinePrint>Saved creation payment · {payment.quote.id.slice(0,8)}</FinePrint><QuietButton onClick={()=>onResumePayment(payment.quote.id)}>Check saved payment</QuietButton></Row>)}
      {positions.verificationUnavailable&&<FinePrint>Showing the last known requests. Verification is temporarily unavailable.</FinePrint>}
      {positions.positionsUpdating&&<FinePrint>Checking for received positions. More vaults may appear as confirmations become available.</FinePrint>}
      {positions.loading?<FinePrint>Loading vaults…</FinePrint>:!positions.error&&!positions.rows.length&&!positions.positionsUpdating?<FinePrint>{positions.page>1||positions.hasNext?'No positions on this page.':'You have no deployments or received positions yet. Choose an incentive program to create your first vault.'}</FinePrint>:null}
      {positions.rows.map(row=><Stack key={row.id} data-deployment-id={row.id} style={{padding:20,border:'1px solid #1d1d1d',borderRadius:'var(--radius-md)',background:'#0a0a0a'}}>
        <Row><b>{row.snapshot.display.pair} · {row.snapshot.durationSeconds/86400} days</b><span role='status'>{statusLabel(row.state)}</span></Row>
        <FinePrint>${(Number(row.snapshot.fixedCapacityAmount)/100).toFixed(2)} LP at request · {row.id.slice(0,8)}</FinePrint>
        <QuietButton onClick={()=>onOpen(row.id,!positions.verificationUnavailable&&(row.depositable||row.canClaim||row.canWithdraw||row.canRecover))}>{positions.verificationUnavailable?'View request':row.depositable?'Deposit':row.canClaim?'Claim premium':row.canWithdraw?'Withdraw':row.canRecover?'Recover LP assets':'View vault'}</QuietButton>
      </Stack>)}
      {positions.payments.filter(row=>!row.deployment_id).map(row=><FinePrint key={row.hash} style={{overflowWrap:'anywhere'}}>Creation payment · {formatUnits(BigInt(row.amount_wei),18)} ETH · {statusLabel(row.state)}. <a href={'https://robinhoodchain.blockscout.com/tx/'+row.hash} target='_blank' rel='noreferrer'>Payment transaction ↗</a></FinePrint>)}
      {(positions.paymentPage>1||positions.hasNextPayments)&&<Row aria-label='Creation payment history'><QuietButton disabled={positions.paymentPage===1||positions.loading} onClick={positions.previousPayments}>Newer payments</QuietButton><FinePrint>Payments page {positions.paymentPage}</FinePrint><QuietButton disabled={!positions.hasNextPayments||positions.loading} onClick={positions.nextPayments}>Older payments</QuietButton></Row>}
      <DeploymentPagination data={positions}/>
      <Row><QuietButton onClick={positions.refresh}>Refresh vaults</QuietButton>{positions.session?.operator&&<QuietButton onClick={onAdmin}>Administration</QuietButton>}</Row>
    </>}
    {positions.error&&<ErrorText role='alert'>{positions.error}</ErrorText>}
  </Stack>
}

/** Mounted only in an authenticated operator's portfolio, never in a modal or
 * homepage. Missing data is unknown, not an assertion that capacity is free. */
function PortfolioCapacity(){
  const load=useCallback((signal:AbortSignal)=>requestJson('/admin/portfolio-capacity',undefined,signal),[])
  const {data,error}=usePollingResource('portfolio-capacity',load,'saffron:catalog-updated,saffron:vault-updated')
  return <>{error?<FinePrint>Capacity advisory is unavailable.</FinePrint>:data?.campaigns?.filter((c:any)=>c.nearCapacity).map((c:any)=><FinePrint role='status' data-capacity-advisory key={c.id} style={{padding:16,border:'1px solid #b8860b',borderRadius:8}}>
    {c.name}: {c.overTarget?'above the planning target':'near capacity'}. This is an advisory only; requests remain open.
  </FinePrint>)}</>
}
