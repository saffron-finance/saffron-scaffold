import { useEffect, useId, useState } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { Modal, ModalTitle } from '../host/ui'
import { loadAdminRequests, type PendingRequest, type usePendingRequests } from '../host/usePendingRequests'
import { Disclosure, ErrorText, FinePrint, Label, QuietButton, Row, Stack } from './styles'
import { exactUsd } from './model'

interface Props {
  account: Address | null
  requests: ReturnType<typeof usePendingRequests>
  onConnect: () => void
  onClose: () => void
}

/** Both views read the existing queue. Admin access requires the host's
 * nonce-bound owner signature; no client-side wallet allowlist is trusted. */
export function PendingRequests({ account, requests, onConnect, onClose }: Props) {
  const [admin, setAdmin] = useState<{ wallet: Address | null; rows?: PendingRequest[]; loading?: boolean; error?: string }>({ wallet: null })
  const titleId = useId()
  useEffect(() => setAdmin({ wallet: null }), [account])
  async function loadAdmin() {
    if (!account) { onConnect(); return }
    setAdmin({ wallet: account, loading: true })
    try { setAdmin({ wallet: account, rows: await loadAdminRequests(account, 4663) }) }
    catch (cause) { setAdmin({ wallet: account, error: cause instanceof Error ? cause.message.split('\n')[0] : 'Admin access unavailable.' }) }
  }
  const currentAdmin = admin.wallet === account ? admin : { wallet: null }
  return <Modal isOpen onRequestClose={onClose} size='wide'>
    <ModalTitle id={titleId} role='heading' aria-level={2} ref={(node: HTMLDivElement | null) => {
      node?.closest('[role="dialog"]')?.setAttribute('aria-labelledby', titleId)
    }}>My requests</ModalTitle><Stack>
      <Row><FinePrint>Your saved vault requests, shared with LiqiFi.</FinePrint><QuietButton onClick={onClose} aria-label='Close pending requests'>Close</QuietButton></Row>
      {!account ? <QuietButton onClick={onConnect}>Connect wallet to view requests</QuietButton> : <>
        <Row><Label>Vault requests</Label><QuietButton onClick={requests.refresh} disabled={requests.loading}>Refresh requests</QuietButton></Row>
        {requests.loading ? <FinePrint role='status'>Loading requests…</FinePrint> : requests.error ? <ErrorText role='alert'>{requests.error}</ErrorText> : <RequestRows rows={requests.rows} />}
      </>}
      <Disclosure><summary>Admin requests</summary>
        <p>Review requests using the Robinhood Chain factory-owner wallet. Verification is a free signature.</p>
        <QuietButton onClick={() => void loadAdmin()} disabled={currentAdmin.loading}>{currentAdmin.loading ? 'Verifying admin…' : 'Load admin requests'}</QuietButton>
        {currentAdmin.error && <ErrorText role='alert'>{currentAdmin.error}</ErrorText>}
        {currentAdmin.rows && <RequestRows rows={currentAdmin.rows} />}
      </Disclosure>
    </Stack>
  </Modal>
}

/** Small-screen-friendly queue rows retain the canonical ID and payment link. */
function RequestRows({ rows }: { rows: PendingRequest[] }) {
  if (!rows.length) return <FinePrint>No vault requests yet.</FinePrint>
  return <List>{rows.map(row => <li key={row.requestId}>
    <Row><b>{row.display.pair}</b><Status>{row.status === 'pending' ? 'Pending review' : row.status === 'created' ? 'Created' : row.status === 'rejected' ? 'Rejected' : row.status}</Status></Row>
    <FinePrint>{row.durationSeconds / 86400} days, {((row.targetApr ?? 0) * 100).toLocaleString()}% APR
      {row.display.depositUsd && `, ${exactUsd(row.display.depositUsd)} deposit`}</FinePrint>
    <FinePrint>Request <code>{row.requestId}</code></FinePrint>
    <FinePrint>Fee: {row.display.paymentAmount} {row.display.paymentAsset}, <a href={`https://arbiscan.io/tx/${row.display.paymentTxHash}`} target='_blank' rel='noreferrer'>view payment ↗</a></FinePrint>
    {row.rejectionReason && <FinePrint>{row.rejectionReason}</FinePrint>}
    {row.adminNotes && <FinePrint>{row.adminNotes}</FinePrint>}
  </li>)}</List>
}

const List = styled.ul`list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;
  li{border:1px solid transparent;border-radius:var(--radius-md);padding:14px;display:flex;flex-direction:column;gap:8px;overflow-wrap:anywhere;font-size:14px}`
const Status = styled.span`color:${({ theme }) => theme.colors.accent.gold};font-size:12px;white-space:nowrap;`
