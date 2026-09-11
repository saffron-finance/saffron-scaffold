/** Safe operator metrics contain counts, ages and identifiers, never journal
 * bytes, recovery capabilities, provider diagnostics or credentials. */
export async function operationalStatus(db,readiness,now=Date.now){
  const rows=(await db.query(`SELECT i.id,i.created_at,j.state,j.updated_at,r.reserved_raw,
    (SELECT max(t.receipt_time) FROM saffron_incentives.chain_operations t WHERE t.intent_id=i.id AND t.receipt_canonical) last_progress,
    o.snapshot->>'verified' verified,o.snapshot->>'checkedAt' checked_at
    FROM saffron_incentives.deployment_intents i JOIN saffron_incentives.vault_jobs j ON j.intent_id=i.id
    JOIN saffron_incentives.budget_reservations r ON r.intent_id=i.id LEFT JOIN saffron_incentives.vault_observations o ON o.intent_id=i.id`)).rows
  const pending=rows.filter(r=>r.state!=='retired'&&(r.state!=='created'||BigInt(r.reserved_raw)>0n))
  const funding=rows.filter(r=>r.state==='created'&&BigInt(r.reserved_raw)>0n)
  const age=row=>Math.max(0,Math.floor((now()-(row.last_progress??row.created_at).getTime())/1000))
  const oldest=items=>items.length?Math.max(...items.map(age)):0
  const payments=(await db.query(`SELECT state,count(*)::int count FROM saffron_incentives.payment_obligations WHERE state NOT IN ('admitted','refunded') GROUP BY state`)).rows
  const budgets=(await db.catalog(true)).budgets.filter(b=>b.reconciliationRequired).map(b=>b.id)
  const stale=rows.filter(r=>r.state==='created'&&(r.verified!=='true'||!r.checked_at||now()-Number(r.checked_at)>15000)).length
  const metrics={pendingServiceRequests:pending.length,oldestWithoutProgressSeconds:oldest(pending),fundingBacklog:funding.length,oldestFundingSeconds:oldest(funding),
    unresolvedPayments:payments.reduce((sum,r)=>sum+r.count,0),paymentStates:payments,staleVaultObservations:stale,reconciliationBudgets:budgets}
  const alerts=readiness.reasons.map(code=>({code,severity:'warning'}))
  if(metrics.oldestWithoutProgressSeconds>(readiness.policy?.service_minutes??240)*60)alerts.push({code:'paid_request_stalled',severity:'critical'})
  if(funding.length)alerts.push({code:'treasury_funding_backlog',severity:'warning'})
  if(metrics.unresolvedPayments)alerts.push({code:'received_fees_need_resolution',severity:'critical'})
  if(stale)alerts.push({code:'vault_observations_stale',severity:'warning'})
  if(budgets.length)alerts.push({code:'campaign_reconciliation_required',severity:'critical'})
  return {metrics,alerts,checkedAt:new Date(now()).toISOString()}
}
