import { useEffect, useMemo, useState } from 'react'
import { formatUnits, parseUnits } from 'viem'
import { type VariableVault } from '../chain/vaults'
import { type FixedRange } from '../chain/fixedRange'
import { clientFor } from '../chain/clients'
import { erc20Abi } from '../chain/abis'
import { depositVariable, type DepositStep } from '../wallet/deposit'
import { hasWallet } from '../wallet/wallet'
import { fmtAmount, shortAddr } from '../lib/format'
import { chainIdFor } from '../chain/chains'
import { TokenLogo, TokenLogoPair, IconWithChain } from './TokenIcon'

const STEP_TEXT: Record<DepositStep, string> = {
  'switch-chain': 'Confirm the network switch in your wallet…',
  checking: 'Checking balance and allowance…',
  approving: 'Approve the token in your wallet…',
  'approve-confirm': 'Waiting for the approval to confirm…',
  depositing: 'Confirm the deposit in your wallet…',
  'deposit-confirm': 'Waiting for the deposit to confirm…',
  done: 'Deposit confirmed.',
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n === 0) return '0'
  if (n < 0.001 || n >= 100000) return n.toPrecision(3)
  return n.toLocaleString('en-US', { maximumSignificantDigits: 5 })
}

export function DepositModal({
  v,
  range,
  account,
  onClose,
  onConnect,
  onDeposited,
  previewOnly = false,
}: {
  v: VariableVault
  range: FixedRange | null
  account: string | null
  onClose: () => void
  onConnect: () => void | Promise<void>
  onDeposited: () => void
  /** Show the complete UI without touching an injected wallet or an RPC. */
  previewOnly?: boolean
}) {
  const [amount, setAmount] = useState('')
  const [balance, setBalance] = useState<bigint | null>(null)
  const [step, setStep] = useState<DepositStep | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [txHash, setTxHash] = useState<string | null>(null)
  const [rangeOpen, setRangeOpen] = useState(false)
  const [inv, setInv] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  // Preview feedback is intentionally local to this modal instance. Closing
  // the modal unmounts it, so the next vault always starts with "Deposit".
  const [previewAttempted, setPreviewAttempted] = useState(false)

  const dec = v.variableAssetDecimals
  const remaining = v.variableRemaining
  // UniV3Vault mints exactly one claim token with a funding-stage fixed deposit.
  // Unknown read state deliberately keeps the normal colors: the neutral style
  // is applied if and only if the authoritative on-chain supply is known zero.
  const fixedUnfilled = v.fixedDepositPresent === false

  useEffect(() => {
    // The GitHub Pages example is deliberately self-contained. Keep this
    // guard local to the modal so a future caller cannot accidentally turn a
    // visual preview into an onchain balance request by passing an account.
    if (previewOnly) return
    if (!account) return
    const client = clientFor(v.chainKey)
    if (!client) return
    let cancelled = false
    void client
      .readContract({ address: v.variableAsset, abi: erc20Abi, functionName: 'balanceOf', args: [account as `0x${string}`] })
      .then((b) => !cancelled && setBalance(b as bigint))
      .catch(() => !cancelled && setBalance(null))
    return () => {
      cancelled = true
    }
  }, [account, previewOnly, v.chainKey, v.variableAsset])

  const maxDepositable = useMemo(() => (balance !== null && balance < remaining ? balance : remaining), [balance, remaining])
  const parsed = useMemo(() => {
    try {
      return amount ? parseUnits(amount, dec) : 0n
    } catch {
      return 0n
    }
  }, [amount, dec])

  const busy = step !== null && step !== 'done'
  const overBalance = balance !== null && parsed > balance
  const valid = parsed > 0n && !overBalance

  // Price band, honoring the token toggle (invert = quote the other way).
  const band = useMemo(() => {
    if (!range) return null
    const [t0, t1] = range.pair.split('/')
    const lo = inv ? 1 / range.priceUpper : range.priceLower
    const hi = inv ? 1 / range.priceLower : range.priceUpper
    const cur = inv ? 1 / range.priceCurrent : range.priceCurrent
    const c = Number.isFinite(cur) ? cur : (lo + hi) / 2
    const min = Math.min(lo, c)
    const max = Math.max(hi, c)
    const pad = (max - min) * 0.18 || Math.abs(max) * 0.1 || 1
    const axisMin = min - pad
    const span = max + pad - axisMin || 1
    const pct = (x: number) => Math.max(0, Math.min(100, ((x - axisMin) / span) * 100))
    return { lo, hi, cur: c, t0, t1, base: inv ? t1 : t0, quote: inv ? t0 : t1, bandLeft: pct(lo), bandWidth: Math.max(3, pct(hi) - pct(lo)), markerLeft: pct(c) }
  }, [range, inv])

  async function handleConnect() {
    // This guard is defense in depth; preview mode never renders the connect
    // control, but it must remain inert if the UI is refactored later.
    if (previewOnly) return
    setConnectError(null)
    if (!hasWallet()) {
      setConnectError('No wallet detected. Install MetaMask (or another browser wallet) to connect.')
      return
    }
    setConnecting(true)
    try {
      await onConnect()
    } catch (e) {
      setConnectError(cleanError(e))
    } finally {
      setConnecting(false)
    }
  }

  async function run() {
    // A static preview may accept sample amount input, but never a transaction.
    if (previewOnly) return
    if (!account) return handleConnect()
    setError(null)
    try {
      const { hash } = await depositVariable(v, amount, account as `0x${string}`, setStep)
      setTxHash(hash)
      onDeposited()
    } catch (e) {
      setError(cleanError(e))
      setStep(null)
    }
  }

  return (
    <div className="dm-backdrop" onClick={() => !busy && onClose()}>
      <div
        className="dm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="deposit-modal-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="dm-head">
          <IconWithChain chainKey={v.chainKey} badge={21}>
            <TokenLogo chainId={chainIdFor(v.chainKey)} address={v.variableAsset} symbol={v.variableAssetSymbol} size={40} />
          </IconWithChain>
          <div className="dm-title" id="deposit-modal-title">{v.variableAssetSymbol} Vault</div>
          <div className="dm-head-right">
            {range && (
              <div className="dm-yield" title={`Yield pair · ${range.pair}`}>
                <TokenLogoPair
                  chainId={chainIdFor(v.chainKey)}
                  a={range.token0}
                  b={range.token1}
                  symbolA={range.pair.split('/')[0]}
                  symbolB={range.pair.split('/')[1]}
                  size={32}
                />
              </div>
            )}
            <button className="dm-x" onClick={onClose} disabled={busy}>
              ×
            </button>
          </div>
        </header>

        <div className="dm-stats">
          <div>
            <span>Capacity</span>
            <b>
              {fmtAmount(remaining, dec)} {v.variableAssetSymbol}
            </b>
          </div>
          <div>
            <span>Max capacity</span>
            <b>
              {fmtAmount(v.variableSideCapacity, dec)} {v.variableAssetSymbol}
            </b>
          </div>
          <div>
            <span>Term</span>
            <b>{Math.round(v.durationSecs / 86400)}d</b>
          </div>
          <div>
            <span>Your balance</span>
            <b>{balance === null ? (account ? '…' : '—') : fmtAmount(balance, dec)}</b>
          </div>
        </div>

        <div className="dm-deposit-label">Deposit {v.variableAssetSymbol}</div>
        <div className="dm-amount">
          <input
            inputMode="decimal"
            placeholder="0.0"
            value={amount}
            disabled={busy}
            onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
          />
          <button className="dm-max" disabled={busy} onClick={() => setAmount(formatUnits(maxDepositable, dec))}>
            MAX
          </button>
        </div>
        {overBalance && <div className="dm-warn">Amount exceeds your balance.</div>}

        {range && band && (
          <div className="dm-range">
            <div className="dm-range-head" onClick={() => setRangeOpen((o) => !o)}>
              <span>View uniswap position</span>
              {!rangeOpen ? (
                <div className={`rangebar rangebar-wide ${fixedUnfilled ? 'fixed-unfilled' : ''}`}>
                  <div className="rangebar-track" />
                  <div className={`rangebar-band ${range.inRange ? '' : 'out'}`} style={{ left: `${band.bandLeft}%`, width: `${band.bandWidth}%` }} />
                  <div className="rangebar-marker" style={{ left: `${band.markerLeft}%` }} />
                </div>
              ) : (
                <div className="dm-toggle" onClick={(e) => e.stopPropagation()}>
                  <span className={!inv ? 'on' : ''} onClick={() => setInv(false)}>
                    {band.t0}
                  </span>
                  <span className={inv ? 'on' : ''} onClick={() => setInv(true)}>
                    {band.t1}
                  </span>
                </div>
              )}
            </div>
            {rangeOpen && (
              <div className="dm-range-body">
                <div className={`rangebar rangebar-full ${fixedUnfilled ? 'fixed-unfilled' : ''}`}>
                  <div className="rangebar-track" />
                  <div className={`rangebar-band ${range.inRange ? '' : 'out'}`} style={{ left: `${band.bandLeft}%`, width: `${band.bandWidth}%` }} />
                  <div className="rangebar-marker" style={{ left: `${band.markerLeft}%` }} />
                </div>
                <div className="dm-range-vals">
                  <span className="dim">{fmtPrice(band.lo)}</span>
                  <span className={`mid ${range.inRange ? '' : 'out'}`}>{fmtPrice(band.cur)}</span>
                  <span className="dim">{fmtPrice(band.hi)}</span>
                </div>
                <div className="lp-rows">
                  <div className="lp-row">
                    <span>Position value</span>
                    <b>
                      {v.fixedDepositPresent === null
                        ? 'Position status unavailable'
                        : fixedUnfilled
                          ? 'Not deposited yet'
                          : 'Position deposited'}
                    </b>
                  </div>
                  <div className="lp-row">
                    <span>Fee tier</span>
                    <b>{range.feePct}%</b>
                  </div>
                  <div className="lp-row">
                    <span>Pool</span>
                    <a href={`${v.explorer}/address/${range.pool}`} target="_blank" rel="noreferrer">
                      {shortAddr(range.pool)} ↗
                    </a>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {step && (
          <div className={`dm-status ${step === 'done' ? 'ok' : ''}`}>
            {step !== 'done' && <span className="spin" />} {STEP_TEXT[step]}
          </div>
        )}
        {error && <div className="dm-error">⚠ {error}</div>}
        {txHash && (
          <a className="dm-tx" href={`${v.explorer}/tx/${txHash}`} target="_blank" rel="noreferrer">
            View transaction {shortAddr(txHash)} ↗
          </a>
        )}

        {connectError && !previewOnly && <div className="dm-notice">{connectError}</div>}
        {previewOnly ? (
          <button className="dm-cta" onClick={() => setPreviewAttempted(true)}>
            {previewAttempted ? 'Deposits disabled in preview' : 'Deposit'}
          </button>
        ) : !account ? (
          <button className="dm-cta" onClick={() => void handleConnect()} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : step === 'done' ? (
          <button className="dm-cta" onClick={onClose}>
            Done
          </button>
        ) : (
          <button className="dm-cta" disabled={!valid || busy} onClick={() => void run()}>
            {busy ? 'Working…' : `Deposit ${amount || '0'} ${v.variableAssetSymbol}`}
          </button>
        )}
        {account && !previewOnly && <div className="dm-account">Wallet {shortAddr(account)} · {v.chainLabel}</div>}
      </div>
    </div>
  )
}

function cleanError(e: unknown): string {
  const msg = (e as Error)?.message ?? String(e)
  if (/User rejected|user denied|rejected the request/i.test(msg)) return 'You rejected the request in your wallet.'
  if (/insufficient funds/i.test(msg)) return 'Insufficient funds for gas.'
  return msg.split('\n')[0].slice(0, 160)
}
