import type { AdminHealth } from '../host/useAdminHealth'
import { QuietButton } from './styles'
import { MetricGrid,OpsButtons,OpsCard,OpsNote,OpsPill,OpsRow } from './operator-styles'

/** The switch and effective payment readiness are different facts. Never show
 * "open" from the policy alone, nor zero metrics while a request is unavailable. */
export function IntakeSummary({report,onStatus,onEdit}:{report:AdminHealth|null;onStatus?:()=>void;onEdit?:()=>void}){
  const policy=report?.readiness?.policy
  const blockers=report?.checks.filter(c=>['blocked','unknown'].includes(c.state))??[]
  return <OpsCard aria-label='Request intake summary'><OpsRow><h2>Request intake</h2><OpsPill $state={report?.canQuote===true?'ready':report?.canQuote===false?'blocked':'unknown'}>{report?.canQuote===true?'Paid requests enabled':report?.canQuote===false?'Paid requests blocked':'Not verified'}</OpsPill></OpsRow>
    <OpsNote>{policy?`Switch ${policy.enabled?'on':'off'} · ${report?.mode==='automatic'?'Automatic queue':'Reviewed execution'} · window expires ${new Date(policy.expires_at).toLocaleString()}`:'No verified intake window.'}</OpsNote>
    <OpsNote>{report?.canQuote===true?'Checkout checks pass. Creation, external premium funding, and each user wallet transaction still have separate requirements.':blockers.length?blockers.map(c=>c.title).join(' · '):'Connect and sign in with an admin wallet to verify the service state.'}</OpsNote>
    <OpsButtons>{onStatus&&<QuietButton onClick={onStatus}>View Status</QuietButton>}{onEdit&&<QuietButton onClick={onEdit}>Edit intake window</QuietButton>}</OpsButtons>
  </OpsCard>
}

export function OperationMetrics({report}:{report:AdminHealth|null}){
  const metrics=report?.metrics
  const cards=[['Pending operations',metrics?.pendingServiceRequests,'Accepted requests not yet fulfilled'],['Awaiting premium',metrics?.fundingBacklog,'External funding required'],['Oldest without progress',metrics?Math.floor(metrics.oldestWithoutProgressSeconds/60)+' min':undefined,'Time without recorded progress'],['Payment exceptions',metrics?.unresolvedPayments,'Original payments preserved']]
  return <MetricGrid aria-label='Operation metrics'>{cards.map(([title,value,detail])=><OpsCard key={title}><OpsNote>{title}</OpsNote><strong style={{fontSize:28,fontWeight:500}}>{value??'—'}</strong><OpsNote>{metrics?detail:'Not verified'}</OpsNote></OpsCard>)}</MetricGrid>
}
