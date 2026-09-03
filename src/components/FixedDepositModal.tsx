import { useMemo, useState } from 'react'
import { chainIdFor } from '../chain/chains'
import {
  fixedCapacityUsd,
  fixedDepositUrl,
  fixedPair,
  fixedPremiumLabel,
  formatPercent,
  formatTokenAmount,
  formatUsd,
  requiredFixedAmounts,
  type FixedVault,
} from '../fixedVaults/model'
import { shortAddr } from '../lib/format'
import { IconWithChain, TokenLogo, TokenLogoPair } from './TokenIcon'

function humanTerm(seconds: number): string {
  const days = Math.round(seconds / 86400)
  if (days >= 7 && days % 7 === 0) return `${days / 7} week${days === 7 ? '' : 's'}`
  return `${days} day${days === 1 ? '' : 's'}`
}

/** Fixed-side single-vault panel, modeled on the left deposit pane in Saffron. */
export function FixedDepositModal({
  vault,
  account,
  onClose,
  onConnect,
  previewOnly,
}: {
  vault: FixedVault
  account: string | null
  onClose: () => void
  onConnect: () => void | Promise<void>
  previewOnly: boolean
}) {
  const [screen, setScreen] = useState<'details' | 'method'>('details')
  const [selectedMethod, setSelectedMethod] = useState<'pair' | 'zap' | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const amounts = useMemo(() => requiredFixedAmounts(vault), [vault])
  const pair = fixedPair(vault)
  const duration = humanTerm(vault.durationSecs)
  const depositUrl = fixedDepositUrl(vault)
  const capacityLabel = formatUsd(fixedCapacityUsd(vault))

  // Match the range treatment in the fixed-income product: pad the domain so
  // the green band is inset, then position the live pool tick on that domain.
  // Keeping this in tick space also preserves the exact bounds shown by the
  // vault list API without inventing a token-price orientation.
  const rangeChart = useMemo(() => {
    const lower = Math.min(vault.minTick, vault.maxTick)
    const upper = Math.max(vault.minTick, vault.maxTick)
    const current = vault.pool.tick
    const domainLower = Math.min(lower, current)
    const domainUpper = Math.max(upper, current)
    const span = domainUpper - domainLower || Math.max(vault.pool.tickSpacing, 1)
    const padding = span * 0.12
    const start = domainLower - padding
    const total = domainUpper + padding - start || 1
    const percent = (value: number) => Math.max(0, Math.min(100, ((value - start) / total) * 100))

    return {
      lower,
      upper,
      current,
      bandLeft: percent(lower),
      bandWidth: Math.max(2, percent(upper) - percent(lower)),
      markerLeft: percent(current),
      inRange: current >= lower && current <= upper,
    }
  }, [vault.maxTick, vault.minTick, vault.pool.tick, vault.pool.tickSpacing])

  async function connect() {
    if (previewOnly) return
    setConnectError(null)
    setConnecting(true)
    try {
      await onConnect()
    } catch (error) {
      setConnectError((error as Error).message.split('\n')[0].slice(0, 160))
    } finally {
      setConnecting(false)
    }
  }

  /**
   * Select one of the two deposit paths from the original fixed-income flow.
   * Static Pages mode stops here by design; live mode asks for a wallet only
   * after the user has chosen how they want to fund the fixed position.
   */
  async function chooseMethod(method: 'pair' | 'zap') {
    setSelectedMethod(method)
    if (previewOnly || account) return
    await connect()
  }

  return (
    <div className="dm-backdrop" onClick={onClose}>
      <section
        className="dm fixed-deposit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="fixed-deposit-modal-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="dm-head">
          {screen === 'method' ? (
            <button
              className="fdm-back"
              type="button"
              onClick={() => {
                setScreen('details')
                setSelectedMethod(null)
                setConnectError(null)
              }}
              aria-label="Back to fixed vault details"
            >
              ←
            </button>
          ) : (
            <IconWithChain chainKey={vault.chainKey} badge={21}>
              <TokenLogoPair
                chainId={chainIdFor(vault.chainKey)}
                a={vault.token0.address}
                b={vault.token1.address}
                symbolA={vault.token0.symbol}
                symbolB={vault.token1.symbol}
                size={40}
              />
            </IconWithChain>
          )}
          <div>
            <div className="dm-title" id="fixed-deposit-modal-title">
              {screen === 'method' ? 'Choose a deposit method' : pair}
            </div>
            <div className="fdm-eyebrow">
              {screen === 'method' ? `${pair} fixed yield vault` : 'Fixed yield vault'}
            </div>
          </div>
          <button className="dm-x" onClick={onClose} aria-label="Close fixed deposit details">×</button>
        </header>

        {screen === 'details' ? (
          <>
            <div className="dm-stats fdm-stats">
              <div><span>Fixed APR</span><b className="fdm-apr">{formatPercent(vault.apr)}</b></div>
              <div><span>Upfront premium</span><b>{fixedPremiumLabel(vault)}</b></div>
              <div><span>Capacity</span><b>{capacityLabel}</b></div>
              <div><span>Term</span><b>{duration}</b></div>
            </div>

            <div className="fdm-section-head">
              <span>Required deposit</span>
              <span className={`fdm-position-status ${vault.isOutOfRange ? 'out' : ''}`}>
                {vault.isOutOfRange ? 'Out of range' : 'Available'}
              </span>
            </div>
            <div className="fdm-required">
              <div>
                <span className="fdm-token">
                  <TokenLogo chainId={vault.chainId} address={vault.token0.address} symbol={vault.token0.symbol} size={24} />
                  {vault.token0.symbol}
                </span>
                <b>{formatTokenAmount(amounts.amount0, vault.token0.decimals)}</b>
              </div>
              <div>
                <span className="fdm-token">
                  <TokenLogo chainId={vault.chainId} address={vault.token1.address} symbol={vault.token1.symbol} size={24} />
                  {vault.token1.symbol}
                </span>
                <b>{formatTokenAmount(amounts.amount1, vault.token1.decimals)}</b>
              </div>
            </div>

            <div className="fdm-range-chart">
              <div className="fdm-range-heading">
                <span>Price range</span>
                <small>
                  Current price is {rangeChart.inRange ? 'inside' : 'outside'} this range
                </small>
              </div>
              <div className="fdm-range-track" aria-hidden="true">
                <span
                  className={`fdm-range-band ${rangeChart.inRange ? '' : 'out'}`}
                  style={{ left: `${rangeChart.bandLeft}%`, width: `${rangeChart.bandWidth}%` }}
                />
                <span className="fdm-range-marker" style={{ left: `${rangeChart.markerLeft}%` }} />
              </div>
              <div className="fdm-range-values">
                <span>{rangeChart.lower.toLocaleString()}</span>
                <b className={rangeChart.inRange ? '' : 'out'}>{rangeChart.current.toLocaleString()}</b>
                <span>{rangeChart.upper.toLocaleString()}</span>
              </div>
            </div>

            <button className="dm-cta" type="button" onClick={() => setScreen('method')}>
              Get {capacityLabel} now
            </button>

            <ul className="fdm-bullets">
              <li>Your {pair} liquidity is locked for <b>{duration}</b>.</li>
              <li>You receive the <b>{fixedPremiumLabel(vault)}</b> premium when the vault starts.</li>
              <li>Your position may experience <b>impermanent loss</b>.</li>
            </ul>
          </>
        ) : (
          <div className="fdm-method-screen">
            <p className="fdm-method-intro">
              Deposit the required vault pair directly, or start with one supported asset and let LI.FI
              build the complete fixed position.
            </p>

            <div className="fdm-method-grid" role="group" aria-label="Deposit method">
              <button
                type="button"
                className={`fdm-method-choice ${selectedMethod === 'pair' ? 'selected' : ''}`}
                aria-pressed={selectedMethod === 'pair'}
                onClick={() => void chooseMethod('pair')}
                disabled={connecting}
              >
                <b>Deposit both tokens</b>
                <span>Use the required {vault.token0.symbol} and {vault.token1.symbol} already in your wallet.</span>
              </button>
              <button
                type="button"
                className={`fdm-method-choice ${selectedMethod === 'zap' ? 'selected' : ''}`}
                aria-pressed={selectedMethod === 'zap'}
                onClick={() => void chooseMethod('zap')}
                disabled={connecting}
              >
                <b>Zap from one asset</b>
                <span>Select one wallet asset, review the LI.FI route, then deposit in one flow.</span>
              </button>
            </div>

            {connectError && <div className="dm-error">⚠ {connectError}</div>}

            {selectedMethod && (
              previewOnly ? (
                <button className="dm-cta" type="button" disabled>
                  Deposits disabled in preview
                </button>
              ) : account ? (
                <a className="dm-cta fdm-cta-link" href={depositUrl} target="_blank" rel="noreferrer">
                  {selectedMethod === 'pair' ? 'Continue with both tokens' : 'Continue with one asset'}
                </a>
              ) : (
                <button className="dm-cta" type="button" disabled>
                  {connecting ? 'Connecting…' : 'Connect wallet to continue'}
                </button>
              )
            )}

            <p className="fdm-method-note">
              {previewOnly
                ? 'Static preview — no wallet, RPC, or transaction request is made.'
                : account
                  ? `Wallet ${shortAddr(account)} · the audited Saffron deposit flow opens next.`
                  : 'Choose a method to connect your wallet and continue.'}
            </p>
          </div>
        )}
      </section>
    </div>
  )
}
