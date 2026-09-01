import { useEffect, useMemo, useRef, useState } from 'react'
import { type VariableVault } from '../chain/vaults'
import { loadFixedRanges, rangeGeometry, type FixedRange } from '../chain/fixedRange'
import { chainIdFor } from '../chain/chains'
import { fmtAmount } from '../lib/format'
import { TokenLogo, TokenLogoPair, IconWithChain } from '../components/TokenIcon'
import { ChainSelector } from '../components/ChainSelector'
import { VaultTokenSelector } from '../components/VaultTokenSelector'
import { PairSelector } from '../components/PairSelector'
import { DepositModal } from '../components/DepositModal'

const PAGE = 12

type SortKey = 'default' | 'vault' | 'capacity' | 'term' | 'yield' | 'range'

function depositable(v: VariableVault): boolean {
  return !v.isStarted && !v.earningsSettled && v.variableRemaining > 0n
}

// A funding-stage fixed deposit mints exactly one claim token. Started vaults
// necessarily filled fixed capacity before starting, even if claim() has since
// replaced that claim token with a fixed bearer token.
function hasFixedDeposit(v: VariableVault): boolean {
  return v.fixedDepositPresent === true
}

function fmtTerm(secs: number): { n: string } {
  const d = Math.round(secs / 86400)
  if (d >= 7 && d % 7 === 0) return { n: `${d / 7}w` }
  if (d >= 1) return { n: `${d}d` }
  return { n: `${Math.max(1, Math.round(secs / 3600))}h` }
}

function RangeBar({ r }: { r: FixedRange }) {
  const g = rangeGeometry(r)
  return (
    <div className="rangebar">
      <div className="rangebar-track" />
      <div className={`rangebar-band ${r.inRange ? '' : 'out'}`} style={{ left: `${g.bandLeft}%`, width: `${g.bandWidth}%` }} />
      <div className="rangebar-marker" style={{ left: `${g.markerLeft}%` }} />
    </div>
  )
}

export function CapacitiesTable({
  vaults,
  account,
  onConnect,
}: {
  vaults: VariableVault[]
  account: string | null
  onConnect: () => void | Promise<void>
}) {
  const [openOnly, setOpenOnly] = useState(true)
  const [inRangeOnly, setInRangeOnly] = useState(true)
  const [filledFixedOnly, setFilledFixedOnly] = useState(false)
  const [optionsOpen, setOptionsOpen] = useState(false)
  const optionsRef = useRef<HTMLDivElement>(null)
  const [chain, setChain] = useState('all')
  const [vaultToken, setVaultToken] = useState('all')
  const [pair, setPair] = useState('all')
  const [sortKey, setSortKey] = useState<SortKey>('default')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)

  const toggleSort = (key: Exclude<SortKey, 'default'>) => {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    else {
      setSortKey(key)
      setSortDir('asc')
    }
  }
  const arrow = (key: SortKey) => (sortKey === key ? (sortDir === 'asc' ? ' ↑' : ' ↓') : '')

  useEffect(() => {
    if (!optionsOpen) return
    const onDoc = (e: MouseEvent) => {
      if (optionsRef.current && !optionsRef.current.contains(e.target as Node)) setOptionsOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [optionsOpen])
  const [ranges, setRanges] = useState<Map<string, FixedRange>>(new Map())
  const [modalVault, setModalVault] = useState<VariableVault | null>(null)

  // The base set the pair dropdown + filter operate on (before the pair filter itself).
  const baseList = useMemo(() => {
    let list = openOnly ? vaults.filter(depositable) : vaults
    if (chain !== 'all') list = list.filter((v) => v.chainKey === chain)
    // This option defaults off, so unfilled fixed-side vaults remain visible
    // until the user explicitly asks to hide them.
    if (filledFixedOnly) list = list.filter(hasFixedDeposit)
    // In-range only: keep vaults whose fixed-side position is in range. A vault whose range hasn't
    // loaded yet passes (so the list doesn't flash empty), then gets filtered once its range is known.
    if (inRangeOnly) list = list.filter((v) => ranges.get(v.vault.toLowerCase())?.inRange ?? true)
    return list
  }, [vaults, openOnly, chain, filledFixedOnly, inRangeOnly, ranges])

  // Vault-token (variable-side token) options across the base set, with counts + a representative.
  const vaultTokenOptions = useMemo(() => {
    const m = new Map<string, { symbol: string; count: number; address?: string; chainId: number }>()
    for (const v of baseList) {
      const cur = m.get(v.variableAssetSymbol)
      if (cur) cur.count++
      else m.set(v.variableAssetSymbol, { symbol: v.variableAssetSymbol, count: 1, address: v.variableAsset, chainId: chainIdFor(v.chainKey) })
    }
    return [...m.values()].sort((a, b) => a.symbol.localeCompare(b.symbol))
  }, [baseList])

  // The vault-token filter narrows the set the pair dropdown + rows work on (cascading, like Uniswap).
  const tokenFiltered = useMemo(
    () => (vaultToken === 'all' ? baseList : baseList.filter((v) => v.variableAssetSymbol === vaultToken)),
    [baseList, vaultToken],
  )

  // Load the fixed-side ranges for the whole base set so we know every vault's yield pair (from its
  // pool's poolKey, read live on-chain — no separate database needed).
  useEffect(() => {
    const missing = baseList.filter((v) => !ranges.has(v.vault.toLowerCase()))
    if (missing.length === 0) return
    let cancelled = false
    void loadFixedRanges(missing).then((m) => {
      if (cancelled) return
      setRanges((prev) => {
        const next = new Map(prev)
        for (const [k, val] of m) next.set(k, val)
        return next
      })
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseList])

  // Distinct pairs across the base set, with counts + a representative token pair (for the icons).
  const pairOptions = useMemo(() => {
    const m = new Map<string, { pair: string; count: number; token0?: string; token1?: string; chainId: number }>()
    for (const v of tokenFiltered) {
      const r = ranges.get(v.vault.toLowerCase())
      if (!r) continue
      const cur = m.get(r.pair)
      if (cur) cur.count++
      else m.set(r.pair, { pair: r.pair, count: 1, token0: r.token0, token1: r.token1, chainId: chainIdFor(v.chainKey) })
    }
    return [...m.values()].sort((a, b) => a.pair.localeCompare(b.pair))
  }, [tokenFiltered, ranges])

  // Reset filters/page appropriately.
  useEffect(() => setPage(1), [openOnly, pair, chain, vaultToken, inRangeOnly, filledFixedOnly, sortKey, sortDir])
  useEffect(() => {
    if (vaultToken !== 'all' && !vaultTokenOptions.some((o) => o.symbol === vaultToken)) setVaultToken('all')
  }, [vaultTokenOptions, vaultToken])
  // If the chosen pair disappears (e.g. after toggling open-only), fall back to all.
  useEffect(() => {
    if (pair !== 'all' && !pairOptions.some((o) => o.pair === pair)) setPair('all')
  }, [pairOptions, pair])

  const rows = useMemo(() => {
    let list = tokenFiltered
    if (pair !== 'all') list = list.filter((v) => ranges.get(v.vault.toLowerCase())?.pair === pair)
    const arr = [...list]
    if (sortKey === 'default') {
      arr.sort((a, b) => {
        const da = depositable(a) ? 1 : 0
        const db = depositable(b) ? 1 : 0
        if (da !== db) return db - da
        return b.variableDeposited > a.variableDeposited ? 1 : -1
      })
    } else {
      const pairOf = (v: VariableVault) => ranges.get(v.vault.toLowerCase())?.pair ?? ''
      const markerOf = (v: VariableVault) => {
        const r = ranges.get(v.vault.toLowerCase())
        return r ? rangeGeometry(r).markerLeft : -1
      }
      const cmp: Record<Exclude<SortKey, 'default'>, (a: VariableVault, b: VariableVault) => number> = {
        vault: (a, b) => a.variableAssetSymbol.localeCompare(b.variableAssetSymbol),
        // Capacity means the amount still available to deposit in this design.
        capacity: (a, b) =>
          a.variableRemaining < b.variableRemaining ? -1 : a.variableRemaining > b.variableRemaining ? 1 : 0,
        term: (a, b) => a.durationSecs - b.durationSecs,
        yield: (a, b) => pairOf(a).localeCompare(pairOf(b)),
        range: (a, b) => markerOf(a) - markerOf(b),
      }
      const mul = sortDir === 'asc' ? 1 : -1
      arr.sort((a, b) => cmp[sortKey](a, b) * mul)
    }
    return arr
  }, [tokenFiltered, pair, ranges, sortKey, sortDir])

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE))
  const pageRows = rows.slice((page - 1) * PAGE, page * PAGE)

  return (
    <>
      <div className="vaults-panel">
        <div className="vaults-head">
          <div className="vaults-title">Vaults</div>
          <div className="vaults-badge">Powered by ✳ Saffron</div>
        </div>
        <div className="vaults-sub">Variable-side capacity across live Saffron vaults. Deposit to earn the vault's real yield.</div>

        <div className="vaults-controls">
          <ChainSelector value={chain} onChange={setChain} />
          <VaultTokenSelector value={vaultToken} onChange={setVaultToken} options={vaultTokenOptions} />
          <PairSelector value={pair} onChange={setPair} options={pairOptions} />
          <div className="chainsel" ref={optionsRef}>
            <button className="options-cog" onClick={() => setOptionsOpen((o) => !o)} title="Options" aria-label="Options">
              ⚙
            </button>
            {optionsOpen && (
              <div className="chainsel-menu options-menu">
                <label className="options-check">
                  <input type="checkbox" checked={inRangeOnly} onChange={(e) => setInRangeOnly(e.target.checked)} />
                  In range only
                </label>
                <label className="options-check">
                  <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
                  Open to deposit only
                </label>
                <label className="options-check">
                  <input
                    type="checkbox"
                    checked={filledFixedOnly}
                    onChange={(e) => setFilledFixedOnly(e.target.checked)}
                  />
                  Filled fixed capacity only
                </label>
              </div>
            )}
          </div>
        </div>

        <div className="vaults-grid-head">
          <button className={`th ${sortKey === 'vault' ? 'th-on' : ''}`} onClick={() => toggleSort('vault')}>
            Vault{arrow('vault')}
          </button>
          <button className={`th ${sortKey === 'capacity' ? 'th-on' : ''}`} onClick={() => toggleSort('capacity')}>
            Capacity{arrow('capacity')}
          </button>
          <button className={`th ${sortKey === 'term' ? 'th-on' : ''}`} onClick={() => toggleSort('term')}>
            Term{arrow('term')}
          </button>
          <button className={`th ${sortKey === 'yield' ? 'th-on' : ''}`} onClick={() => toggleSort('yield')}>
            Yield{arrow('yield')}
          </button>
          <button className={`th ${sortKey === 'range' ? 'th-on' : ''}`} onClick={() => toggleSort('range')}>
            Range{arrow('range')}
          </button>
        </div>

        <div className="vaults-rows">
          {pageRows.map((v) => {
            const r = ranges.get(v.vault.toLowerCase())
            const term = fmtTerm(v.durationSecs)
            const canDeposit = depositable(v)
            return (
              <div
                key={`${v.chainKey}-${v.factory}-${v.vaultId}`}
                className={`vault-row ${canDeposit ? 'is-open' : ''}`}
                onClick={() => canDeposit && setModalVault(v)}
              >
                <div className="vr-vault vr-vault-first" data-label="Vault">
                  <IconWithChain chainKey={v.chainKey}>
                    <TokenLogo chainId={chainIdFor(v.chainKey)} address={v.variableAsset} symbol={v.variableAssetSymbol} size={30} />
                  </IconWithChain>
                  <span>{v.variableAssetSymbol}</span>
                </div>
                <div className="vr-cap" data-label="Capacity">
                  <span className="vr-table-value">
                    {fmtAmount(v.variableRemaining, v.variableAssetDecimals)} available
                  </span>
                </div>
                <div className="vr-term" data-label="Term">
                  <span className="vr-table-value">{term.n}</span>
                </div>
                <div className="vr-yield" data-label="Yield">
                  {r ? (
                    <TokenLogoPair
                      chainId={chainIdFor(v.chainKey)}
                      a={r.token0}
                      b={r.token1}
                      symbolA={r.pair.split('/')[0]}
                      symbolB={r.pair.split('/')[1]}
                      size={30}
                    />
                  ) : (
                    <span className="vr-dim">…</span>
                  )}
                  <span className="vr-pair">{r ? r.pair : ''}</span>
                </div>
                <div className="vr-range" data-label="Range">{r ? <RangeBar r={r} /> : <span className="vr-dim">…</span>}</div>
              </div>
            )
          })}
          {rows.length === 0 && <div className="vaults-empty">No vaults match this filter.</div>}
        </div>

        {totalPages > 1 && (
          <div className="vaults-pager">
            <button disabled={page === 1} onClick={() => setPage((p) => p - 1)}>
              ‹
            </button>
            <span>
              {page} / {totalPages}
            </span>
            <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)}>
              ›
            </button>
          </div>
        )}
      </div>

      {modalVault && (
        <DepositModal
          v={modalVault}
          range={ranges.get(modalVault.vault.toLowerCase()) ?? null}
          account={account}
          onClose={() => setModalVault(null)}
          onConnect={onConnect}
          onDeposited={() => {}}
        />
      )}
    </>
  )
}
