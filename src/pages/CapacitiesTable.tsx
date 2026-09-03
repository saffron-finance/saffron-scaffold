import { useEffect, useMemo, useRef, useState } from 'react'
import { formatUnits } from 'viem'
import { type VariableVault } from '../chain/vaults'
import { loadFixedRanges, rangeGeometry, type FixedRange } from '../chain/fixedRange'
import { chainIdFor } from '../chain/chains'
import {
  fixedCapacityUsd,
  fixedDepositable,
  fixedPair,
  fixedPremiumLabel,
  fixedPremiumUsd,
  formatPercent,
  formatUsd,
  formatUsdWhole,
  type FixedVault,
} from '../fixedVaults/model'
import { fmtAmount } from '../lib/format'
import { TokenLogo, TokenLogoPair, IconWithChain } from '../components/TokenIcon'
import { ChainSelector } from '../components/ChainSelector'
import { VaultTokenSelector } from '../components/VaultTokenSelector'
import { PairSelector } from '../components/PairSelector'
import { DepositModal } from '../components/DepositModal'
import { FixedDepositModal } from '../components/FixedDepositModal'
import { IS_STATIC_MOCK } from '../mock/mode'

const PAGE = 12
const TABLE_TOKEN_ICON_SIZE = 20
const TABLE_CHAIN_BADGE_SIZE = 10

type SortKey = 'default' | 'vault' | 'capacity' | 'term' | 'yield' | 'premium' | 'range'
export type YieldMode = 'variable' | 'fixed'

function depositable(vault: VariableVault): boolean {
  return !vault.isStarted && !vault.earningsSettled && vault.variableRemaining > 0n
}

function hasFixedDeposit(vault: VariableVault): boolean {
  return vault.fixedDepositPresent === true
}

function fmtTerm(seconds: number): string {
  const days = Math.round(seconds / 86400)
  if (days >= 7 && days % 7 === 0) return `${days / 7}w`
  if (days >= 1) return `${days}d`
  return `${Math.max(1, Math.round(seconds / 3600))}h`
}

function RangeBar({ range }: { range: FixedRange }) {
  const geometry = rangeGeometry(range)
  return (
    <div className="rangebar">
      <div className="rangebar-track" />
      <div
        className={`rangebar-band ${range.inRange ? '' : 'out'}`}
        style={{ left: `${geometry.bandLeft}%`, width: `${geometry.bandWidth}%` }}
      />
      <div className="rangebar-marker" style={{ left: `${geometry.markerLeft}%` }} />
    </div>
  )
}

export function CapacitiesTable({
  vaults,
  fixedVaults,
  variableAssetPricesUsd,
  fixedLoading,
  fixedErrors,
  account,
  onConnect,
  readOnly = false,
  yieldMode,
  onYieldModeChange,
}: {
  vaults: VariableVault[]
  fixedVaults: FixedVault[]
  variableAssetPricesUsd: ReadonlyMap<string, number>
  fixedLoading: boolean
  fixedErrors: string[]
  account: string | null
  onConnect: () => void | Promise<void>
  readOnly?: boolean
  yieldMode: YieldMode
  onYieldModeChange: (mode: YieldMode) => void
}) {
  const [openOnly, setOpenOnly] = useState(true)
  const [inRangeOnly, setInRangeOnly] = useState(true)
  const [filledCounterSideOnly, setFilledCounterSideOnly] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)
  const [chain, setChain] = useState('all')
  const [vaultToken, setVaultToken] = useState('all')
  const [pair, setPair] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [ranges, setRanges] = useState<Map<string, FixedRange>>(new Map())
  const [variableModalVault, setVariableModalVault] = useState<VariableVault | null>(null)
  const [fixedModalVault, setFixedModalVault] = useState<FixedVault | null>(null)

  const variableCapacityLabel = (vault: VariableVault): string => {
    const priceUsd = variableAssetPricesUsd.get(vault.variableAsset.toLowerCase())
    if (priceUsd == null || priceUsd <= 0) return '—'
    const tokenAmount = Number(formatUnits(vault.variableRemaining, vault.variableAssetDecimals))
    return formatUsdWhole(tokenAmount * priceUsd)
  }

  const toggleSort = (key: Exclude<SortKey, 'default'>) => {
    if (sortKey === key) setSortDir((direction) => (direction === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  useEffect(() => {
    if (!optionsOpen) return
    const onDocumentClick = (event: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(event.target as Node)) setOptionsOpen(false)
    }
    document.addEventListener('mousedown', onDocumentClick)
    return () => document.removeEventListener('mousedown', onDocumentClick)
  }, [optionsOpen])

  useEffect(() => {
    if (!IS_STATIC_MOCK) return
    let cancelled = false
    void import('../mock/snapshot').then(({ loadMockRanges }) => {
      if (!cancelled) setRanges(loadMockRanges())
    })
    return () => {
      cancelled = true
    }
  }, [])

  const variableBaseList = useMemo(() => {
    let list = openOnly ? vaults.filter(depositable) : vaults
    if (chain !== 'all') list = list.filter((vault) => vault.chainKey === chain)
    if (filledCounterSideOnly) list = list.filter(hasFixedDeposit)
    if (inRangeOnly) list = list.filter((vault) => ranges.get(vault.vault.toLowerCase())?.inRange ?? true)
    return list
  }, [vaults, openOnly, chain, filledCounterSideOnly, inRangeOnly, ranges])

  const fixedBaseList = useMemo(() => {
    let list = openOnly ? fixedVaults.filter(fixedDepositable) : fixedVaults
    if (chain !== 'all') list = list.filter((vault) => vault.chainKey === chain)
    if (filledCounterSideOnly) {
      list = list.filter((vault) => {
        const target = vault.variableAsset.capacity ?? 0n
        return target > 0n && vault.variableDeposited >= target
      })
    }
    if (inRangeOnly) list = list.filter((vault) => !vault.isOutOfRange)
    return list
  }, [fixedVaults, openOnly, chain, filledCounterSideOnly, inRangeOnly])

  useEffect(() => {
    if (IS_STATIC_MOCK) return
    const missing = variableBaseList.filter((vault) => !ranges.has(vault.vault.toLowerCase()))
    if (missing.length === 0) return
    let cancelled = false
    void loadFixedRanges(missing).then((loaded) => {
      if (cancelled) return
      setRanges((current) => {
        const next = new Map(current)
        for (const [address, range] of loaded) next.set(address, range)
        return next
      })
    })
    return () => {
      cancelled = true
    }
  }, [variableBaseList, ranges])

  const variableVaultTokenOptions = useMemo(() => {
    const options = new Map<string, { symbol: string; count: number; address?: string; chainId: number }>()
    for (const vault of variableBaseList) {
      const current = options.get(vault.variableAssetSymbol)
      if (current) current.count++
      else options.set(vault.variableAssetSymbol, {
        symbol: vault.variableAssetSymbol,
        count: 1,
        address: vault.variableAsset,
        chainId: chainIdFor(vault.chainKey),
      })
    }
    return [...options.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [variableBaseList])

  const fixedVaultTokenOptions = useMemo(() => {
    const options = new Map<string, { symbol: string; count: number; address?: string; chainId: number }>()
    for (const vault of fixedBaseList) {
      for (const token of [vault.token0, vault.token1]) {
        const current = options.get(token.symbol)
        if (current) current.count++
        else options.set(token.symbol, { symbol: token.symbol, count: 1, address: token.address, chainId: vault.chainId })
      }
    }
    return [...options.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [fixedBaseList])

  const currentVaultTokenOptions = yieldMode === 'fixed' ? fixedVaultTokenOptions : variableVaultTokenOptions
  const variableTokenFiltered = useMemo(
    () => vaultToken === 'all' ? variableBaseList : variableBaseList.filter((vault) => vault.variableAssetSymbol === vaultToken),
    [variableBaseList, vaultToken],
  )
  const fixedTokenFiltered = useMemo(
    () => vaultToken === 'all'
      ? fixedBaseList
      : fixedBaseList.filter((vault) => vault.token0.symbol === vaultToken || vault.token1.symbol === vaultToken),
    [fixedBaseList, vaultToken],
  )

  const variablePairOptions = useMemo(() => {
    const options = new Map<string, { pair: string; count: number; token0?: string; token1?: string; chainId: number }>()
    for (const vault of variableTokenFiltered) {
      const range = ranges.get(vault.vault.toLowerCase())
      if (!range) continue
      const current = options.get(range.pair)
      if (current) current.count++
      else options.set(range.pair, { pair: range.pair, count: 1, token0: range.token0, token1: range.token1, chainId: chainIdFor(vault.chainKey) })
    }
    return [...options.values()].sort((a, b) => a.pair.localeCompare(b.pair))
  }, [variableTokenFiltered, ranges])

  const fixedPairOptions = useMemo(() => {
    const options = new Map<string, { pair: string; count: number; token0?: string; token1?: string; chainId: number }>()
    for (const vault of fixedTokenFiltered) {
      const label = fixedPair(vault)
      const current = options.get(label)
      if (current) current.count++
      else options.set(label, { pair: label, count: 1, token0: vault.token0.address, token1: vault.token1.address, chainId: vault.chainId })
    }
    return [...options.values()].sort((a, b) => a.pair.localeCompare(b.pair))
  }, [fixedTokenFiltered])

  const currentPairOptions = yieldMode === 'fixed' ? fixedPairOptions : variablePairOptions

  useEffect(() => setPage(1), [yieldMode, openOnly, pair, chain, vaultToken, inRangeOnly, filledCounterSideOnly, sortKey, sortDir])
  useEffect(() => {
    if (vaultToken !== 'all' && !currentVaultTokenOptions.some((option) => option.symbol === vaultToken)) setVaultToken('all')
  }, [currentVaultTokenOptions, vaultToken])
  useEffect(() => {
    if (pair !== 'all' && !currentPairOptions.some((option) => option.pair === pair)) setPair('all')
  }, [currentPairOptions, pair])

  const variableRows = useMemo(() => {
    let list = variableTokenFiltered
    if (pair !== 'all') list = list.filter((vault) => ranges.get(vault.vault.toLowerCase())?.pair === pair)
    const rows = [...list]
    if (sortKey === 'default') {
      rows.sort((a, b) => {
        const availability = Number(depositable(b)) - Number(depositable(a))
        return availability || (b.variableDeposited > a.variableDeposited ? 1 : -1)
      })
    } else {
      const pairOf = (vault: VariableVault) => ranges.get(vault.vault.toLowerCase())?.pair ?? ''
      const markerOf = (vault: VariableVault) => {
        const range = ranges.get(vault.vault.toLowerCase())
        return range ? rangeGeometry(range).markerLeft : -1
      }
      const comparators: Record<Exclude<SortKey, 'default'>, (a: VariableVault, b: VariableVault) => number> = {
        vault: (a, b) => a.variableAssetSymbol.localeCompare(b.variableAssetSymbol),
        capacity: (a, b) => a.variableRemaining < b.variableRemaining ? -1 : a.variableRemaining > b.variableRemaining ? 1 : 0,
        term: (a, b) => a.durationSecs - b.durationSecs,
        yield: (a, b) => pairOf(a).localeCompare(pairOf(b)),
        premium: () => 0,
        range: (a, b) => markerOf(a) - markerOf(b),
      }
      const direction = sortDir === 'asc' ? 1 : -1
      rows.sort((a, b) => comparators[sortKey](a, b) * direction)
    }
    return rows
  }, [variableTokenFiltered, pair, ranges, sortKey, sortDir])

  const fixedRows = useMemo(() => {
    let list = fixedTokenFiltered
    if (pair !== 'all') list = list.filter((vault) => fixedPair(vault) === pair)
    const rows = [...list]
    const comparators: Record<Exclude<SortKey, 'default'>, (a: FixedVault, b: FixedVault) => number> = {
      vault: (a, b) => fixedPair(a).localeCompare(fixedPair(b)),
      capacity: (a, b) => fixedCapacityUsd(a) - fixedCapacityUsd(b),
      term: (a, b) => a.durationSecs - b.durationSecs,
      yield: (a, b) => a.apr - b.apr,
      premium: (a, b) => fixedPremiumUsd(a) - fixedPremiumUsd(b),
      range: (a, b) => Number(a.isOutOfRange) - Number(b.isOutOfRange),
    }
    const key = sortKey === 'default' ? 'yield' : sortKey
    const direction = sortKey === 'default' ? -1 : sortDir === 'asc' ? 1 : -1
    rows.sort((a, b) => comparators[key](a, b) * direction)
    return rows
  }, [fixedTokenFiltered, pair, sortKey, sortDir])

  const activeRows = yieldMode === 'fixed' ? fixedRows : variableRows
  const totalPages = Math.max(1, Math.ceil(activeRows.length / PAGE))
  const pageStart = (page - 1) * PAGE
  const variablePageRows = variableRows.slice(pageStart, pageStart + PAGE)
  const fixedPageRows = fixedRows.slice(pageStart, pageStart + PAGE)

  return (
    <>
      <div className="vaults-panel">
        <div className="vaults-head">
          <div className="vaults-title">Vaults</div>
          <div className="vaults-badge">Powered by ✳ Saffron</div>
        </div>
        <div className="vaults-sub">
          {yieldMode === 'variable'
            ? "Variable-side capacity across live Saffron vaults. Deposit to earn the vault's real yield."
            : 'Available fixed-side vaults. Provide the required Uniswap pair and earn the upfront premium.'}
        </div>

        <div className="vaults-controls">
          <select
            className="pair-select yield-mode-select"
            value={yieldMode}
            aria-label="Yield type"
            onChange={(event) => {
              onYieldModeChange(event.target.value as YieldMode)
              setVaultToken('all')
              setPair('all')
              setSortKey('default')
              setVariableModalVault(null)
              setFixedModalVault(null)
            }}
          >
            <option value="variable">Variable yield</option>
            <option value="fixed">Fixed yield</option>
          </select>
          <ChainSelector value={chain} onChange={setChain} />
          <VaultTokenSelector value={vaultToken} onChange={setVaultToken} options={currentVaultTokenOptions} />
          <PairSelector value={pair} onChange={setPair} options={currentPairOptions} />
          <div className="chainsel" ref={optionsRef}>
            <button className="options-cog" onClick={() => setOptionsOpen((open) => !open)} title="Options" aria-label="Options">⚙</button>
            {optionsOpen && (
              <div className="chainsel-menu options-menu">
                <label className="options-check">
                  <input type="checkbox" checked={inRangeOnly} onChange={(event) => setInRangeOnly(event.target.checked)} />
                  In range only
                </label>
                <label className="options-check">
                  <input type="checkbox" checked={openOnly} onChange={(event) => setOpenOnly(event.target.checked)} />
                  Open to deposit only
                </label>
                <label className="options-check">
                  <input type="checkbox" checked={filledCounterSideOnly} onChange={(event) => setFilledCounterSideOnly(event.target.checked)} />
                  {yieldMode === 'fixed' ? 'Filled variable capacity only' : 'Filled fixed capacity only'}
                </label>
              </div>
            )}
          </div>
        </div>

        {yieldMode === 'fixed' ? (
          <>
            <div className="vaults-grid-head fixed-grid">
              <button className={`th ${sortKey === 'vault' ? 'th-on' : ''}`} onClick={() => toggleSort('vault')}>Vault{arrow('vault')}</button>
              <button className={`th ${sortKey === 'yield' ? 'th-on' : ''}`} onClick={() => toggleSort('yield')}>APR{arrow('yield')}</button>
              <button className={`th ${sortKey === 'premium' ? 'th-on' : ''}`} onClick={() => toggleSort('premium')}>Upfront premium{arrow('premium')}</button>
              <button className={`th ${sortKey === 'capacity' ? 'th-on' : ''}`} onClick={() => toggleSort('capacity')}>Capacity{arrow('capacity')}</button>
              <button className={`th ${sortKey === 'term' ? 'th-on' : ''}`} onClick={() => toggleSort('term')}>Term{arrow('term')}</button>
            </div>
            <div className="vaults-rows">
              {fixedPageRows.map((vault) => (
                <div
                  key={`${vault.chainKey}-${vault.address}`}
                  className="vault-row fixed-vault-row is-open"
                  role="button"
                  tabIndex={0}
                  aria-label={`View ${fixedPair(vault)} fixed deposit details`}
                  onClick={() => setFixedModalVault(vault)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      setFixedModalVault(vault)
                    }
                  }}
                >
                  <div className="vr-vault vr-vault-first" data-label="Vault">
                    <IconWithChain chainKey={vault.chainKey} badge={TABLE_CHAIN_BADGE_SIZE}>
                      <TokenLogoPair chainId={vault.chainId} a={vault.token0.address} b={vault.token1.address} symbolA={vault.token0.symbol} symbolB={vault.token1.symbol} size={TABLE_TOKEN_ICON_SIZE} />
                    </IconWithChain>
                    <span>{fixedPair(vault)}</span>
                  </div>
                  <div className="fixed-apr" data-label="APR">{formatPercent(vault.apr)}</div>
                  <div
                    className="fixed-premium"
                    data-label="Upfront premium"
                    title={fixedPremiumLabel(vault)}
                    aria-label={`Upfront premium ${formatUsdWhole(fixedPremiumUsd(vault))}; ${fixedPremiumLabel(vault)}`}
                  >
                    <TokenLogo chainId={vault.chainId} address={vault.variableAsset.address} symbol={vault.variableAsset.symbol} size={TABLE_TOKEN_ICON_SIZE} />
                    <span className="table-usd-value">{formatUsdWhole(fixedPremiumUsd(vault))}</span>
                  </div>
                  <div className="fixed-capacity" data-label="Capacity">{formatUsd(fixedCapacityUsd(vault))}</div>
                  <div className="fixed-term" data-label="Term">{fmtTerm(vault.durationSecs)}</div>
                </div>
              ))}
              {fixedLoading && fixedRows.length === 0 && <div className="vaults-empty">Loading fixed-side vaults…</div>}
              {!fixedLoading && fixedRows.length === 0 && <div className="vaults-empty">No fixed-side vaults match this filter.</div>}
              {fixedErrors.length > 0 && fixedRows.length === 0 && <div className="vaults-empty">Fixed-side data is temporarily unavailable.</div>}
            </div>
          </>
        ) : (
          <>
            <div className="vaults-grid-head">
              <button className={`th ${sortKey === 'vault' ? 'th-on' : ''}`} onClick={() => toggleSort('vault')}>Vault{arrow('vault')}</button>
              <button className={`th ${sortKey === 'capacity' ? 'th-on' : ''}`} onClick={() => toggleSort('capacity')}>Capacity{arrow('capacity')}</button>
              <button className={`th ${sortKey === 'term' ? 'th-on' : ''}`} onClick={() => toggleSort('term')}>Term{arrow('term')}</button>
              <button className={`th ${sortKey === 'yield' ? 'th-on' : ''}`} onClick={() => toggleSort('yield')}>Yield{arrow('yield')}</button>
              <button className={`th ${sortKey === 'range' ? 'th-on' : ''}`} onClick={() => toggleSort('range')}>Range{arrow('range')}</button>
            </div>
            <div className="vaults-rows">
              {variablePageRows.map((vault) => {
                const range = ranges.get(vault.vault.toLowerCase())
                const canDeposit = depositable(vault)
                return (
                  <div
                    key={`${vault.chainKey}-${vault.factory}-${vault.vaultId}`}
                    className={`vault-row ${canDeposit ? 'is-open' : ''}`}
                    role={canDeposit ? 'button' : undefined}
                    tabIndex={canDeposit ? 0 : undefined}
                    aria-label={canDeposit ? `View ${vault.variableAssetSymbol} vault deposit details` : undefined}
                    onClick={() => canDeposit && setVariableModalVault(vault)}
                    onKeyDown={(event) => {
                      if (canDeposit && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault()
                        setVariableModalVault(vault)
                      }
                    }}
                  >
                    <div className="vr-vault vr-vault-first" data-label="Vault">
                      <IconWithChain chainKey={vault.chainKey} badge={TABLE_CHAIN_BADGE_SIZE}>
                        <TokenLogo chainId={chainIdFor(vault.chainKey)} address={vault.variableAsset} symbol={vault.variableAssetSymbol} size={TABLE_TOKEN_ICON_SIZE} />
                      </IconWithChain>
                      <span>{vault.variableAssetSymbol}</span>
                    </div>
                    <div
                      className="vr-cap"
                      data-label="Capacity"
                      title={`${fmtAmount(vault.variableRemaining, vault.variableAssetDecimals)} ${vault.variableAssetSymbol}`}
                      aria-label={`Capacity ${variableCapacityLabel(vault)}; ${fmtAmount(vault.variableRemaining, vault.variableAssetDecimals)} ${vault.variableAssetSymbol}`}
                    >
                      <span className="vr-table-value">{variableCapacityLabel(vault)}</span>
                    </div>
                    <div className="vr-term" data-label="Term"><span className="vr-table-value">{fmtTerm(vault.durationSecs)}</span></div>
                    <div className="vr-yield" data-label="Yield">
                      {range ? <TokenLogoPair chainId={chainIdFor(vault.chainKey)} a={range.token0} b={range.token1} symbolA={range.pair.split('/')[0]} symbolB={range.pair.split('/')[1]} size={TABLE_TOKEN_ICON_SIZE} /> : <span className="vr-dim">…</span>}
                      <span className="vr-pair">{range?.pair ?? ''}</span>
                    </div>
                    <div className="vr-range" data-label="Range">{range ? <RangeBar range={range} /> : <span className="vr-dim">…</span>}</div>
                  </div>
                )
              })}
              {variableRows.length === 0 && <div className="vaults-empty">No vaults match this filter.</div>}
            </div>
          </>
        )}

        {totalPages > 1 && (
          <div className="vaults-pager">
            <button disabled={page === 1} onClick={() => setPage((current) => current - 1)}>‹</button>
            <span>{page} / {totalPages}</span>
            <button disabled={page === totalPages} onClick={() => setPage((current) => current + 1)}>›</button>
          </div>
        )}
      </div>

      {variableModalVault && (
        <DepositModal
          v={variableModalVault}
          range={ranges.get(variableModalVault.vault.toLowerCase()) ?? null}
          account={account}
          onClose={() => setVariableModalVault(null)}
          onConnect={onConnect}
          onDeposited={() => {}}
          previewOnly={readOnly}
        />
      )}
      {fixedModalVault && (
        <FixedDepositModal
          vault={fixedModalVault}
          account={account}
          onClose={() => setFixedModalVault(null)}
          onConnect={onConnect}
          previewOnly={readOnly}
        />
      )}
    </>
  )
}
