import { useEffect } from 'react'
import { useVaults } from './hooks/useVaults'
import { useWallet } from './hooks/useWallet'
import { CapacitiesTable } from './pages/CapacitiesTable'
import { shortAddr } from './lib/format'

/**
 * Render the standalone LiqiFi experience.
 *
 * This repository contains one design and one route. The earlier application
 * switched between two page variants based on the URL; keeping that branch in
 * a standalone package would make the old page an accidental hidden feature.
 */
export default function App() {
  const { vaults, errors } = useVaults()
  const wallet = useWallet()

  // The light canvas is painted on body, outside React's root element.
  useEffect(() => {
    document.body.classList.add('liqifi-body')
    return () => document.body.classList.remove('liqifi-body')
  }, [])

  return (
    <div className="page liqifi">
      <header className="top">
        <div>
          <div className="brand">
            <span className="brand-mark" />
            <span className="brand-name">LiqiFi</span>
          </div>
          <h1>Single-staking boosted yield.</h1>
          <p className="sub">Earn boosted yield from existing onchain Uniswap LP positions.</p>
        </div>
        <div className="top-actions">
          {wallet.available && (
            <button className="wallet-btn" onClick={() => void wallet.connect()} disabled={wallet.connecting}>
              {wallet.account ? `● ${shortAddr(wallet.account)}` : wallet.connecting ? 'Connecting…' : 'Connect wallet'}
            </button>
          )}
        </div>
      </header>

      {errors.length > 0 && (
        <div className="errors">
          {errors.map((error, index) => (
            <div key={index}>⚠ {error}</div>
          ))}
        </div>
      )}

      <CapacitiesTable
        vaults={vaults}
        account={wallet.account}
        onConnect={() => wallet.connect()}
      />
    </div>
  )
}
