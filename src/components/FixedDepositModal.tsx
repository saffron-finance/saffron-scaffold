import { useMemo, useState } from 'react'
import { chainIdFor } from '../chain/chains'
import {
  fixedCapacityUsd,
  fixedDepositUrl,
  fixedPair,
  fixedPremiumLabel,
  fixedPremiumUsd,
  formatPercent,
  formatTokenAmount,
  formatUsd,
  requiredFixedAmounts,
  type FixedVault,
} from '../fixedVaults/model'
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
  const [screen, setScreen] = useState<'details' | 'confirm'>('details')
  const [slippageBps, setSlippageBps] = useState(50)
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const [previewNotice, setPreviewNotice] = useState(false)
  const amounts = useMemo(() => requiredFixedAmounts(vault), [vault])
  const pair = fixedPair(vault)
  const duration = humanTerm(vault.durationSecs)
  const depositUrl = fixedDepositUrl(vault)
  const capacityLabel = formatUsd(fixedCapacityUsd(vault))
  const premiumUsdLabel = formatUsd(fixedPremiumUsd(vault))

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
          {screen === 'confirm' ? (
            <button
              className="fdm-back"
              type="button"
              onClick={() => {
                setScreen('details')
                setConnectError(null)
                setPreviewNotice(false)
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
              {screen === 'confirm' ? 'Confirm deposit' : pair}
            </div>
            {screen === 'details' && <div className="fdm-eyebrow">Fixed yield vault</div>}
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

            <button className="dm-cta" type="button" onClick={() => setScreen('confirm')}>
              Get {capacityLabel} now
            </button>

            <ul className="fdm-bullets">
              <li>Your {pair} liquidity is locked for <b>{duration}</b>.</li>
              <li>You receive the <b>{fixedPremiumLabel(vault)}</b> premium when the vault starts.</li>
              <li>Your position may experience <b>impermanent loss</b>.</li>
            </ul>
          </>
        ) : (
          <div className="fdm-confirm-screen">
            {/* Keep the confirmation language aligned with the audited fixed
                form while filling every value from the selected vault. */}
            <ul className="fdm-confirm-bullets">
              <li>
                <span className="fdm-confirm-dot" aria-hidden="true" />
                <span>
                  <b>{formatTokenAmount(amounts.amount0, vault.token0.decimals)} {vault.token0.symbol}</b>
                  {' '}and{' '}
                  <b>{formatTokenAmount(amounts.amount1, vault.token1.decimals)} {vault.token1.symbol}</b>
                  {' '}will be deposited into a Uniswap LP.
                </span>
              </li>
              <li>
                <span className="fdm-confirm-dot" aria-hidden="true" />
                <span>Your LP is locked for <b>{duration}</b>.</span>
              </li>
              <li>
                <span className="fdm-confirm-dot" aria-hidden="true" />
                <span>You receive <b className="fdm-confirm-premium">+{premiumUsdLabel}</b> upfront premium right now.</span>
              </li>
              <li>
                <span className="fdm-confirm-dot" aria-hidden="true" />
                <span>Your position may suffer <b>impermanent loss</b>.</span>
              </li>
            </ul>

            {/* The selector mirrors the supplied confirmation screen. The
                audited Saffron form remains the source of truth at handoff. */}
            <div className="fdm-slippage-row">
              <span className="fdm-slippage-label">Slippage</span>
              <div className="fdm-slippage-options" role="group" aria-label="Slippage tolerance">
                {[10, 50, 100].map((bps) => (
                  <button
                    key={bps}
                    type="button"
                    className={slippageBps === bps ? 'selected' : ''}
                    aria-pressed={slippageBps === bps}
                    onClick={() => setSlippageBps(bps)}
                  >
                    {bps / 100}%
                  </button>
                ))}
              </div>
            </div>

            {connectError && <div className="dm-error">⚠ {connectError}</div>}
            {previewNotice && (
              <div className="fdm-preview-notice" role="status">
                Static preview — no wallet or transaction request is made.
              </div>
            )}

            <p className="fdm-uniswap-note">
              You&apos;re providing liquidity to Uniswap v3
            </p>

            {previewOnly ? (
              <button className="dm-cta fdm-confirm-cta" type="button" onClick={() => setPreviewNotice(true)}>
                Deposit
              </button>
            ) : account ? (
              <a className="dm-cta fdm-cta-link fdm-confirm-cta" href={depositUrl} target="_blank" rel="noreferrer">
                Deposit
              </a>
            ) : (
              <button className="dm-cta fdm-confirm-cta" type="button" onClick={() => void connect()} disabled={connecting}>
                {connecting ? 'Connecting…' : 'Deposit'}
              </button>
            )}
          </div>
        )}
      </section>
    </div>
  )
}
