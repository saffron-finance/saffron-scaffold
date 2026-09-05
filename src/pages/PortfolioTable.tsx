import { formatUnits } from 'viem'
import { type Address } from 'viem'
import { type VariableVault } from '../chain/vaults'
import { usePortfolio } from '../hooks/usePortfolio'
import { shortAddr } from '../lib/format'
import { saffronVaultUrl } from '../lib/vaultLinks'

function status(vault: VariableVault): string {
  if (vault.earningsSettled) return 'Settled'
  if (vault.isStarted) return 'Earning'
  return 'Waiting to start'
}

export function PortfolioTable({ account, vaults, onConnect, previewOnly = false }: {
  account: Address | null
  vaults: VariableVault[]
  onConnect: () => void | Promise<void>
  previewOnly?: boolean
}) {
  const portfolio = usePortfolio(account, vaults)
  return (
    <section className="portfolio-panel">
      <div className="vaults-head">
        <div className="vaults-title">Portfolio</div>
        {account && <div className="vaults-badge">{shortAddr(account)}</div>}
      </div>
      <p className="vaults-sub">Your current variable-side Saffron deposits.</p>
      {!account ? (
        <div className="portfolio-empty">
          <p>{previewOnly ? 'Portfolio tracking is disabled in the static preview.' : 'Connect your wallet to see deposits.'}</p>
          {!previewOnly && <button className="dm-cta portfolio-connect" onClick={() => void onConnect()}>Connect wallet</button>}
        </div>
      ) : portfolio.loading ? (
        <div className="portfolio-empty"><span className="spin" /> Loading portfolio…</div>
      ) : portfolio.error ? (
        <div className="dm-error">⚠ {portfolio.error}</div>
      ) : portfolio.positions.length === 0 ? (
        <div className="portfolio-empty">No active deposits found for this wallet.</div>
      ) : (
        <div className="portfolio-scroll">
          <table className="portfolio-table">
            <thead><tr><th>Vault</th><th>Network</th><th>Deposit</th><th>Status</th><th /></tr></thead>
            <tbody>
              {portfolio.positions.map(({ vault, balance }) => (
                <tr key={`${vault.chainKey}:${vault.vault}`}>
                  <td><b>{vault.variableAssetSymbol}</b><small>{shortAddr(vault.vault)}</small></td>
                  <td>{vault.chainLabel}</td>
                  <td>{Number(formatUnits(balance, vault.variableAssetDecimals)).toLocaleString(undefined, { maximumFractionDigits: 6 })} {vault.variableAssetSymbol}</td>
                  <td><span className="portfolio-status">{status(vault)}</span></td>
                  <td><a href={saffronVaultUrl(vault.chainKey, vault.vault)} target="_blank" rel="noreferrer">Open vault ↗</a></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
