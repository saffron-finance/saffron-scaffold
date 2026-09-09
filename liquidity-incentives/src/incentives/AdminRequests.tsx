import { useEffect, useState } from 'react'
import { formatUnits, type Address } from 'viem'
import styled from 'styled-components'
import { ModalTitle } from '../host/ui'
import { useOperator } from '../host/useOperator'
import { requestJson } from '../host/transport'
import { Disclosure, ErrorText, FinePrint, QuietButton, Row, Stack } from './styles'
import { depositCents } from '../../shared/vault-sizing.mjs'
import { ProgramAdmin } from './ProgramAdmin'

/** A wallet session authorizes queue actions; only the separate local worker signs. */
export function AdminRequests({ account, onConnect, onBack }: { account: Address | null; onConnect: () => void; onBack: () => void }) {
  const operator = useOperator(account)
  const [data, setData] = useState<any>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [reviews, setReviews] = useState<Record<string, { cents: string; reason: string }>>({})
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    let active = true
    setData(null)
    if (!operator.session) return
    async function refresh() {
      if (document.visibilityState !== 'visible') return
      try { const value = await requestJson('/admin/requests'); if (active) { setData(value); setError(null) } }
      catch (cause) { if (active) setError(cause instanceof Error ? cause.message : 'Queue unavailable.') }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => { active = false; clearInterval(timer); window.removeEventListener('focus', refresh); document.removeEventListener('visibilitychange', refresh) }
  }, [operator.session?.wallet, operator.session?.expiresAt, revision])
  async function action(row: any, kind: 'create' | 'fund') {
    setBusy(row.requestId); setError(null)
    try {
      await operator.mutate(`/admin/${encodeURIComponent(row.requestId)}/${kind}`, kind === 'create'
        ? { termsDigest: row.lifecycle.termsDigest, resume: Boolean(row.lifecycle.job), sizingReview: reviews[row.requestId] }
        : { termsDigest: row.lifecycle.termsDigest, maximumRaw: row.lifecycle.job.plan.premium })
      setRevision(value => value + 1)
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Admin action failed.') }
    finally { setBusy(null) }
  }
  return <Stack>
    <Row><ModalTitle role='heading' aria-level={2}>Admin requests</ModalTitle><QuietButton onClick={onBack}>Back to offers</QuietButton></Row>
    <FinePrint>Create queues the requested terms for the local unrestricted deployer. Funding is a separate, explicit approval.</FinePrint>
    {!account ? <QuietButton onClick={onConnect}>Connect operator wallet</QuietButton> : operator.checking ? <FinePrint role='status'>Restoring operator session…</FinePrint> : !operator.session ?
      <QuietButton disabled={operator.busy} onClick={() => void operator.login()}>{operator.busy ? 'Verifying operator…' : 'Sign in as operator'}</QuietButton> : <>
      <FinePrint>Operator session expires {new Date(operator.session.expiresAt).toLocaleTimeString()}. Polling does not request signatures.</FinePrint>
      {data && <FinePrint>{!data.creatorConfigured ? 'Local deployer is not configured.' : data.creatorOnline ? 'Local deployer online.' : 'Local deployer offline — queued work will resume when it returns.'} Queue refreshes every 5 seconds.</FinePrint>}
      {!data && !error && <FinePrint role='status'>Loading admin queue…</FinePrint>}
      {data && <Table><thead><tr><th>Requested vault</th><th>Creation</th><th>Funding / availability</th><th>Action</th></tr></thead>
        <tbody>{data.data.map((row: any) => {
          const job = row.lifecycle?.job, plan = job?.plan
          return <tr key={row.requestId}>
            <td><b>{row.display.pair}</b><p>{row.display.depositUsd} USD · {row.durationSeconds / 86400} days</p>
              <Disclosure><summary>Request terms</summary><p>{row.requestId}</p><p>Requester: {row.submitterAddress}</p><p>Pool: {row.poolAddress}</p><p>APR: {(row.targetApr * 100).toLocaleString()}%</p><p>Factory: {data.factory}</p></Disclosure></td>
            <td>{job?.state ?? row.status}<p>{row.createdVaultAddress && <a href={`https://robinhoodchain.blockscout.com/address/${row.createdVaultAddress}`} target='_blank' rel='noreferrer'>View vault ↗</a>}</p>
              {job?.transactions?.map((tx: any) => <p key={tx.hash}><a href={`https://robinhoodchain.blockscout.com/tx/${tx.hash}`} target='_blank' rel='noreferrer'>{tx.step}: {tx.status} ↗</a></p>)}
              {job?.error && <ErrorText>{job.error}</ErrorText>}</td>
            <td>{row.lifecycle?.reason}<p>{job?.fundingState && `Funding: ${job.fundingState}`}</p></td>
            <td>{row.status === 'pending' && !job && depositCents(row.display.depositUsd) !== row.fixedCapacityAmount && <Disclosure><summary>Required sizing review</summary>
              <p>The stored amount differs from the paid receipt. Approve a new sizing snapshot, without changing the receipt.</p>
              <label>Approved USD cents<input aria-label={'Approved USD cents for ' + row.requestId} inputMode='numeric' value={reviews[row.requestId]?.cents ?? ''} onChange={event => setReviews(previous => ({...previous,[row.requestId]:{reason:previous[row.requestId]?.reason ?? '',cents:event.target.value}}))} /></label>
              <label>Review reason<input aria-label={'Sizing review reason for ' + row.requestId} value={reviews[row.requestId]?.reason ?? ''} onChange={event => setReviews(previous => ({...previous,[row.requestId]:{cents:previous[row.requestId]?.cents ?? '',reason:event.target.value}}))} /></label>
            </Disclosure>}{row.status === 'pending' && <QuietButton disabled={Boolean(busy) || !data.creatorConfigured || (job && !['failed', 'waiting'].includes(job.state))}
              onClick={() => void action(row, 'create')}>{busy === row.requestId ? 'Queuing…' : job ? 'Resume creation' : 'Create vault'}</QuietButton>}
              {row.status === 'created' && plan && !row.lifecycle.depositable && ['unapproved','funded','failed'].includes(job.fundingState) && <Disclosure><summary>Admin premium funding</summary>
                <p>Approve a transfer of at most {formatUnits(BigInt(plan.premium), plan.variableDecimals)} {plan.variableSymbol} from the local deployer to this vault. Only the remaining amount is sent.</p>
                <QuietButton disabled={Boolean(busy) || !data.creatorConfigured} onClick={() => void action(row, 'fund')}>Approve premium funding</QuietButton></Disclosure>}
              {job?.fundingState === 'waiting' && <FinePrint>Reconciling the previous funding transaction; no duplicate will be sent.</FinePrint>}</td>
          </tr>
        })}</tbody></Table>}
      {data && !data.data.length && <FinePrint>No requested vaults.</FinePrint>}
      <Disclosure><summary>Manage incentive programs</summary><ProgramAdmin account={account} onConnect={onConnect} /></Disclosure>
    </>}
    {(error || operator.error) && <ErrorText role='alert'>{error || operator.error}</ErrorText>}
  </Stack>
}
const Table = styled.table`width:100%;border-collapse:collapse;font-size:13px;table-layout:fixed;a{color:${({ theme }) => theme.colors.accent.gold};text-decoration:underline}th,td{text-align:left;vertical-align:top;padding:16px 12px;border-bottom:1px solid #433253;overflow-wrap:anywhere}th{color:${({ theme }) => theme.colors.accent.gold}}p{margin:8px 0;line-height:1.5}@media(max-width:800px){thead{display:none}tbody,tr,td{display:block;width:100%}tr{border:1px solid #433253;margin-bottom:16px;border-radius:8px}td{border:0}td:last-child{padding-bottom:20px}}`
