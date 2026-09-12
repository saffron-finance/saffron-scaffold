import type { Address } from 'viem'
import { useAdminHealth } from '../host/useAdminHealth'
import { StepTitle } from '../host/ui'
import { Action,ErrorText,QuietButton,Stack } from './styles'
import { ConfigurationWarnings } from './ConfigurationWarnings'
import { IntakeSummary } from './OperatorOverview'
import { OpsButtons,OpsCard,OpsGrid,OpsNote,OpsPill,OpsRow } from './operator-styles'
import { StartupSteps } from './JourneyGuide'
import { OperatorWalletCheck } from './OperatorWalletCheck'

const labels={ready:'Ready',blocked:'Blocked',warning:'Needs attention',unknown:'Not verified',manual:'Manual check'}

/** Each check has evidence, an owner, and a concrete next action. Service
 * controls remain outside the keyless API; this screen only performs reads. */
export function OperatorStatus({account,onConnect,onNavigate}:{account:Address|null;onConnect:()=>void;onNavigate:(path:string)=>void}){
  const health=useAdminHealth(account),report=health.unavailable?null:health.report
  return <Stack>
    <OpsRow><StepTitle>Status</StepTitle><OpsButtons><QuietButton onClick={()=>onNavigate('/admin')}>Administration</QuietButton><QuietButton onClick={health.refresh}>Refresh checks</QuietButton></OpsButtons></OpsRow>
    <OpsNote>See what is ready, why a request is blocked, and who can fix it. Refreshing checks does not open intake or start a service.</OpsNote>
    {!account?<Action onClick={onConnect}>Connect operator wallet</Action>:!health.session?<Action disabled={health.busy} onClick={()=>void health.signIn()}>Sign in as operator</Action>:!health.session.operator?<ErrorText>This wallet is not an operator.</ErrorText>:null}
    {health.signError&&<ErrorText role='alert'>{health.signError}</ErrorText>}
    {health.unavailable&&<ErrorText role='alert'>Status could not be verified. Check the API connection or sign in again. Previous results are not used to claim readiness.</ErrorText>}
    {health.loading&&<OpsNote role='status'>Checking operator access…</OpsNote>}
    <OperatorWalletCheck account={account} operator={Boolean(health.session?.operator)}/>
    <IntakeSummary report={report} onEdit={()=>onNavigate('/admin')}/>
    <OpsCard><details><summary>How to turn on paid requests</summary><StartupSteps onNavigate={onNavigate}/></details></OpsCard>
    {report&&<>
      <OpsNote>Last checked {new Date(report.checkedAt).toLocaleString()} · refreshes automatically. A recent worker heartbeat proves liveness, not a successful vault creation.</OpsNote>
      <OpsGrid>{report.checks.filter(c=>c.state!=='manual').sort((a,b)=>({blocked:0,unknown:1,warning:2,ready:3,manual:4}[a.state]-{blocked:0,unknown:1,warning:2,ready:3,manual:4}[b.state])).map(check=><OpsCard key={check.id} data-status-check={check.id}><OpsRow><h3>{check.title}</h3><OpsPill $state={check.state}>{labels[check.state]}</OpsPill></OpsRow><p>{check.detail}</p>{check.state==='ready'?<details><summary>Check details and next action</summary><p><b>Who: {check.owner}</b><br/>{check.action}</p></details>:<p><b>Who: {check.owner}</b><br/>{check.action}</p>}</OpsCard>)}</OpsGrid>
      <OpsCard><h2>Before serving users: manual checks</h2><p>These items are not verified by the automatic checks. A green checkout status does not replace them.</p></OpsCard>
      <OpsGrid>{report.checks.filter(c=>c.state==='manual').map(check=><OpsCard key={check.id} data-status-check={check.id}><OpsRow><h3>{check.title}</h3><OpsPill $state='manual'>Manual check</OpsPill></OpsRow><p>{check.detail}</p><p><b>Who: {check.owner}</b><br/>{check.action}</p></OpsCard>)}</OpsGrid>
      <OpsCard><h2>Wallet roles</h2><p>The admin wallet signs management actions. The creator wallet pays gas for vault creation. The fee recipient receives user request fees. These roles are not interchangeable.</p>
        <p>Configured creator: <code>{report.signer??'Not configured'}</code><br/>Fee recipient: <code>{report.feeRecipient??'Not configured'}</code></p>
        {account?.toLowerCase()===report.feeRecipient?.toLowerCase()&&<OpsPill $state='warning'>This connected wallet is the fee recipient. Use a different payer wallet to test a paid request; self-payment is rejected.</OpsPill>}
      </OpsCard>
    </>}
    <ConfigurationWarnings account={account}/>
  </Stack>
}
