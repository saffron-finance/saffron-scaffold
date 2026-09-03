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
  const [connecting, setConnecting] = useState(false)
  const [connectError, setConnectError] = useState<string | null>(null)
  const amounts = useMemo(() => requiredFixedAmounts(vault), [vault])
  const pair = fixedPair(vault)
  const duration = humanTerm(vault.durationSecs)
  const depositUrl = fixedDepositUrl(vault)

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
          <div>
            <div className="dm-title" id="fixed-deposit-modal-title">{pair}</div>
            <div className="fdm-eyebrow">Fixed yield vault</div>
          </div>
          <button className="dm-x" onClick={onClose} aria-label="Close fixed deposit details">×</button>
        </header>

        <div className="dm-stats fdm-stats">
          <div><span>Fixed APR</span><b className="fdm-apr">{formatPercent(vault.apr)}</b></div>
          <div><span>Upfront premium</span><b>{fixedPremiumLabel(vault)}</b></div>
          <div><span>Capacity</span><b>{formatUsd(fixedCapacityUsd(vault))}</b></div>
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

        <div className="fdm-range-summary">
          <span>Uniswap v3 range</span>
          <b>{vault.minTick.toLocaleString()} → {vault.maxTick.toLocaleString()}</b>
          <small>{vault.isOutOfRange ? 'Current price is outside this range' : 'Current price is inside this range'}</small>
        </div>

        <div className="fdm-total-row">
          <span>Total value</span>
          <b>{formatUsd(fixedCapacityUsd(vault))}</b>
        </div>
        <div className="fdm-total-row">
          <span>Upfront premium</span>
          <b className="fdm-premium">+{formatUsd(fixedPremiumUsd(vault))}</b>
        </div>

        {connectError && <div className="dm-error">⚠ {connectError}</div>}
        {previewOnly ? (
          <button className="dm-cta" disabled>Deposits disabled in preview</button>
        ) : !account ? (
          <button className="dm-cta" onClick={() => void connect()} disabled={connecting}>
            {connecting ? 'Connecting…' : 'Connect wallet'}
          </button>
        ) : (
          <a className="dm-cta fdm-cta-link" href={depositUrl} target="_blank" rel="noreferrer">
            Deposit
          </a>
        )}

        <ul className="fdm-bullets">
          <li>Your {pair} liquidity is locked for <b>{duration}</b>.</li>
          <li>You receive the <b>{fixedPremiumLabel(vault)}</b> premium when the vault starts.</li>
          <li>Your position may experience <b>impermanent loss</b>.</li>
        </ul>

        {account && !previewOnly && (
          <div className="dm-account">Wallet {shortAddr(account)} · deposit opens in Saffron</div>
        )}
      </section>
    </div>
  )
}
