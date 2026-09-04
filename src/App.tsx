import { useEffect, useState } from 'react'
import { useVaults } from './hooks/useVaults'
import { useFixedVaults } from './hooks/useFixedVaults'
import { useWallet } from './hooks/useWallet'
import { CapacitiesTable, type YieldMode } from './pages/CapacitiesTable'
import { shortAddr } from './lib/format'
import { IS_STATIC_MOCK } from './mock/mode'

// Vite rewrites BASE_URL for both the standalone server and the relative
// GitHub Pages build, keeping one public icon source for both deployments.
const SAFFRON_ICON_URL = `${import.meta.env.BASE_URL}saffron-icon.svg`

/**
 * Render the standalone Saffron Scaffold experience.
 *
 * This repository contains one design and one route. The earlier application
 * switched between two page variants based on the URL; keeping that branch in
 * a standalone package would make the old page an accidental hidden feature.
 */
export default function App() {
  const { vaults, errors } = useVaults()
  const fixed = useFixedVaults()
  const wallet = useWallet()
  const [yieldMode, setYieldMode] = useState<YieldMode>('variable')

  // The light canvas is painted on body, outside React's root element.
  useEffect(() => {
    document.body.classList.add('saffron-scaffold-body')
    return () => document.body.classList.remove('saffron-scaffold-body')
  }, [])

  return (
    <div className="page saffron-scaffold">
      <header className="top">
        <div>
          <div className="brand">
            <img className="brand-mark" src={SAFFRON_ICON_URL} alt="" aria-hidden="true" />
            <span className="brand-name">Saffron Scaffold</span>
          </div>
          <h1>
            {yieldMode === 'fixed'
              ? 'Earn an upfront premium for your Uniswap LP'
              : 'Buy future yield from an existing Uniswap LP'}
          </h1>
          <p className="sub">
            {yieldMode === 'fixed'
              ? 'Get paid now for depositing any Uniswap position. Find a matching position below.'
              : 'Purchase the right to earn yield from an existing Uniswap position.'}
          </p>
        </div>
        <div className="top-actions">
          {!IS_STATIC_MOCK && wallet.available && (
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
        fixedVaults={fixed.vaults}
        variableAssetPricesUsd={fixed.variableAssetPricesUsd}
        fixedLoading={fixed.loading}
        fixedErrors={fixed.errors}
        account={IS_STATIC_MOCK ? null : wallet.account}
        onConnect={() => (IS_STATIC_MOCK ? Promise.resolve() : wallet.connect())}
        onFixedDeposited={() => (IS_STATIC_MOCK ? Promise.resolve() : fixed.refresh())}
        readOnly={IS_STATIC_MOCK}
        yieldMode={yieldMode}
        onYieldModeChange={setYieldMode}
      />
    </div>
  )
}
