import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { Modal, ModalTitle } from '../host/ui'
import { loadAdminRequests, requestHandoff, type PendingRequest, type usePendingRequests } from '../host/usePendingRequests'
import { Disclosure, ErrorText, FinePrint, Label, QuietButton, Row, Stack } from './styles'
import { exactUsd } from './model'
import { ProgramAdmin } from './ProgramAdmin'

interface Props {
  account: Address | null
  requests: ReturnType<typeof usePendingRequests>
  onImport: (file: File) => Promise<void>
  onConnect: () => void
  onClose: () => void
}

/** Both views read the existing queue. Admin access requires the host's
 * nonce-bound owner signature; no client-side wallet allowlist is trusted. */
export function PendingRequests({ account, requests, onImport, onConnect, onClose }: Props) {
  const [admin, setAdmin] = useState<{ wallet: Address | null; rows?: PendingRequest[]; loading?: boolean; error?: string }>({ wallet: null })
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const receiptInput = useRef<HTMLInputElement | null>(null)
  const titleId = useId()
  const close = () => { if (!importing) onClose() }
  async function selectReceipt(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = '' // Allow retrying the same file after an error.
    if (!file) return
    setImportError(null); setImporting(true)
    try { await onImport(file) }
    catch (cause) { setImportError(cause instanceof Error ? cause.message : 'The receipt could not be imported. Try again.') }
    finally { setImporting(false) }
  }
  useEffect(() => setAdmin({ wallet: null }), [account])
  async function loadAdmin() {
    if (!account) { onConnect(); return }
    setAdmin({ wallet: account, loading: true })
    try { setAdmin({ wallet: account, rows: await loadAdminRequests(account, 4663) }) }
    catch (cause) { setAdmin({ wallet: account, error: cause instanceof Error ? cause.message.split('\n')[0] : 'Admin access unavailable.' }) }
  }
  const currentAdmin = admin.wallet === account ? admin : { wallet: null }
  const empty = Boolean(account && !requests.loading && !requests.error && !requests.rows.length)
  return <Modal isOpen onRequestClose={close} shouldCloseOnOverlayClick={!importing} size='wide'>
    <ModalTitle id={titleId} role='heading' aria-level={2} ref={(node: HTMLDivElement | null) => {
      node?.closest('[role="dialog"]')?.setAttribute('aria-labelledby', titleId)
    }}>My requests</ModalTitle><Stack>
      <Row><FinePrint>Track review and open your vault when it is ready.</FinePrint><QuietButton onClick={close} disabled={importing} aria-label='Close pending requests'>Close</QuietButton></Row>
      {!account ? <QuietButton onClick={onConnect}>Connect wallet to view requests</QuietButton> : <>
        <Row><Label>Vault requests</Label><QuietButton onClick={requests.refresh} disabled={requests.loading}>Refresh requests</QuietButton></Row>
        {requests.loading ? <FinePrint role='status'>Loading requests…</FinePrint> : requests.error ? <ErrorText role='alert'>{requests.error}</ErrorText> : <RequestRows rows={requests.rows} />}
      </>}
      <Row>
        {empty && <FinePrint>Already paid?</FinePrint>}
        <QuietButton type='button' onClick={() => receiptInput.current?.click()} disabled={importing || currentAdmin.loading}>
          {importing ? 'Importing…' : empty ? 'Import your receipt' : 'Import receipt'}
        </QuietButton>
        <input ref={receiptInput} type='file' accept='.json,application/json' aria-label='Request receipt file' hidden onChange={event => void selectReceipt(event)} />
      </Row>
      {importError && <ErrorText role='alert'>{importError}</ErrorText>}
      <Disclosure><summary>Admin requests</summary>
        <p>Review requests using the Robinhood Chain factory-owner wallet. Verification is a free signature.</p>
        <QuietButton onClick={() => void loadAdmin()} disabled={currentAdmin.loading}>{currentAdmin.loading ? 'Verifying admin…' : 'Load admin requests'}</QuietButton>
        {currentAdmin.error && <ErrorText role='alert'>{currentAdmin.error}</ErrorText>}
        {currentAdmin.rows && <RequestRows rows={currentAdmin.rows} admin />}
      </Disclosure>
      <Disclosure><summary>Manage incentive programs</summary><AdminArea><ProgramAdmin account={account} onConnect={onConnect} /></AdminArea></Disclosure>
    </Stack>
  </Modal>
}

const AdminArea = styled.div`padding-top:18px;`

/** Small-screen-friendly queue rows retain the canonical ID and payment link. */
function RequestRows({ rows, admin = false }: { rows: PendingRequest[]; admin?: boolean }) {
  if (!rows.length) return <FinePrint>No vault requests yet.</FinePrint>
  return <List>{rows.map(row => <RequestRow key={`${row.requestId}:${row.status}:${row.createdVaultAddress}`} row={row} admin={admin} />)}</List>
}

function RequestRow({ row, admin }: { row: PendingRequest; admin: boolean }) {
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  async function open(action: 'create' | 'fixed' | 'variable') {
    setOpening(true); setError(null)
    try {
      const url = await requestHandoff(row, action)
      if (mounted.current) {
        window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#requests`)
        window.location.assign(url)
      }
    } catch (cause) {
      if (mounted.current) { setError(cause instanceof Error ? cause.message : 'Vault handoff is unavailable.'); setOpening(false) }
    }
  }
  return <li>
    <Row><b>{row.display.pair}</b><Status>{row.status === 'pending' ? 'Pending review' : row.status === 'created' ? 'Created' : row.status === 'rejected' ? 'Rejected' : row.status}</Status></Row>
    <FinePrint>{row.durationSeconds / 86400} days, {((row.targetApr ?? 0) * 100).toLocaleString()}% APR
      {row.display.depositUsd && `, ${exactUsd(row.display.depositUsd)} deposit`}</FinePrint>
    <FinePrint>Request <code>{row.requestId}</code></FinePrint>
    <FinePrint>Fee: {row.display.paymentAmount} {row.display.paymentAsset}, <a href={`https://arbiscan.io/tx/${row.display.paymentTxHash}`} target='_blank' rel='noreferrer'>view payment ↗</a></FinePrint>
    {row.rejectionReason && <FinePrint>{row.rejectionReason}</FinePrint>}
    {row.adminNotes && <FinePrint>{row.adminNotes}</FinePrint>}
    {row.handoffEnabled && <>
      {admin && row.status === 'pending' && <Row><QuietButton disabled={opening} onClick={() => void open('create')}>Review &amp; create vault</QuietButton></Row>}
      {row.status === 'created' && row.createdVaultAddress && <>
        <Row><QuietButton disabled={opening} onClick={() => void open('fixed')}>Open fixed side</QuietButton>
          <QuietButton disabled={opening} onClick={() => void open('variable')}>Open variable side</QuietButton></Row>
        <FinePrint>Deposit liquidity on the fixed side, or fund the premium on the variable side. Available actions appear in your vault.</FinePrint>
      </>}
    </>}
    {!row.handoffEnabled && (admin || row.status === 'created') && <FinePrint>The fixed-income connection is not configured yet.</FinePrint>}
    {opening && <FinePrint role='status'>Checking vault destination…</FinePrint>}
    {error && <ErrorText role='alert'>{error}</ErrorText>}
  </li>
}

const List = styled.ul`list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;
  li{border:1px solid transparent;border-radius:var(--radius-md);padding:14px;display:flex;flex-direction:column;gap:8px;overflow-wrap:anywhere;font-size:14px}`
const Status = styled.span`color:${({ theme }) => theme.colors.accent.gold};font-size:12px;white-space:nowrap;`
