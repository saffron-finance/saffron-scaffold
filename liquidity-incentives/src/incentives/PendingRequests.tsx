import { useRef, useState, type ChangeEvent } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { Modal, ModalTitle } from '../host/ui'
import type { PendingRequest, usePendingRequests } from '../host/usePendingRequests'
import { depositStorageKey } from '../host/useVaultDeposit'
import { eligibility } from '../../shared/vault-lifecycle.mjs'
import { ErrorText, FinePrint, QuietButton, Row, Stack } from './styles'
import { exactUsd } from './model'

interface Props {
  account: Address | null; requests: ReturnType<typeof usePendingRequests>
  onImport: (file: File) => Promise<void>; onConnect: () => void; onClose: () => void
  onDeposit: (id: string) => void; onAdmin: () => void; embedded?: boolean
}

/** Receipt recovery and funded vaults share one wallet-filtered request view. */
export function PendingRequests({ account, requests, onImport, onConnect, onClose, onDeposit, onAdmin, embedded = false }: Props) {
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  async function selectReceipt(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (!file) return
    setError(null); setImporting(true)
    try { await onImport(file) }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'Receipt import failed.') }
    finally { setImporting(false) }
  }
  const empty = Boolean(account && !requests.loading && !requests.error && !requests.rows.length)
  const content = <Stack>
    <Row><ModalTitle role='heading' aria-level={2}>My requests</ModalTitle>
      <QuietButton onClick={onClose} disabled={importing} aria-label='Close pending requests'>{embedded ? 'Back to offers' : 'Close'}</QuietButton></Row>
    <FinePrint>Deposits unlock after creation and full admin funding. Updates every 5 seconds.</FinePrint>
    {!account ? <QuietButton onClick={onConnect}>Connect wallet to view requests</QuietButton> : <>
      <Row><b>Vault requests</b><QuietButton onClick={requests.refresh} disabled={requests.loading}>Refresh requests</QuietButton></Row>
      {requests.loading && <FinePrint role='status'>Updating requests…</FinePrint>}
      {requests.error && <ErrorText role='alert'>{requests.error}</ErrorText>}
      {empty && <FinePrint>No vault requests yet.</FinePrint>}
      <List>{requests.rows.map(row => <RequestRow key={row.requestId} row={row} account={account} onDeposit={onDeposit} />)}</List>
    </>}
    {empty && <FinePrint>Already paid?</FinePrint>}
    <Row><QuietButton onClick={() => input.current?.click()} disabled={importing}>{importing ? 'Importing…' : empty ? 'Import your receipt' : 'Import receipt'}</QuietButton>
      <QuietButton onClick={onAdmin}>Admin queue</QuietButton></Row>
    <input ref={input} type='file' accept='.json,application/json' aria-label='Request receipt file' hidden onChange={event => void selectReceipt(event)} />
    {error && <ErrorText role='alert'>{error}</ErrorText>}
  </Stack>
  return embedded ? content : <Modal isOpen onRequestClose={onClose} shouldCloseOnOverlayClick={!importing} size='wide'>{content}</Modal>
}

/** Re-evaluate freshness in the browser: a cached green server response is insufficient. */
function RequestRow({ row, account, onDeposit }: { row: PendingRequest; account: Address; onDeposit: (id: string) => void }) {
  const available = row.lifecycle?.depositable && eligibility(row.lifecycle?.observation).depositable
  let recovering = false
  try { recovering = Boolean(localStorage.getItem(depositStorageKey(account, row.requestId))) } catch { /* Storage disabled: normal eligibility still applies. */ }
  const status = row.status === 'rejected' ? 'Rejected' : available ? 'Depositable' : row.lifecycle?.reason ?? (row.status === 'created' ? 'Awaiting admin funding' : 'Awaiting creation')
  return <li>
    <Row><b>{row.display.pair}</b><Status>{status}</Status></Row>
    <FinePrint>{row.durationSeconds / 86400} days · {((row.targetApr ?? 0) * 100).toLocaleString()}% APR{row.display.depositUsd && ` · ${exactUsd(row.display.depositUsd)} deposit`}</FinePrint>
    <FinePrint>Request <code>{row.requestId}</code></FinePrint>
    <FinePrint>Fee: {row.display.paymentAmount} {row.display.paymentAsset} · <a href={`https://arbiscan.io/tx/${row.display.paymentTxHash}`} target='_blank' rel='noreferrer'>View payment ↗</a></FinePrint>
    {row.createdVaultAddress && <FinePrint><a href={`https://robinhoodchain.blockscout.com/address/${row.createdVaultAddress}`} target='_blank' rel='noreferrer'>Vault on Robinhood ↗</a></FinePrint>}
    {row.rejectionReason && <FinePrint>{row.rejectionReason}</FinePrint>}
    {!available && row.lifecycle?.reason && row.lifecycle.reason !== status && <FinePrint>{row.lifecycle.reason}</FinePrint>}
    {(available || recovering) && <Row><QuietButton onClick={() => onDeposit(row.requestId)}>{recovering ? 'Resume transaction' : 'Deposit'}</QuietButton></Row>}
  </li>
}
const List = styled.ul`list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:12px;a{color:${({ theme }) => theme.colors.accent.gold};text-decoration:underline}li{border:1px solid #433253;border-radius:var(--radius-md);padding:20px;display:flex;flex-direction:column;gap:10px;overflow-wrap:anywhere;font-size:14px}`
const Status = styled.span`color:${({ theme }) => theme.colors.accent.gold};font-size:13px;`
