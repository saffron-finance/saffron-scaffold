import { useEffect, useRef, useState } from 'react'
import { TokenLogo } from './TokenIcon'

export interface VaultTokenOption {
  symbol: string
  count: number
  address?: string
  chainId: number
}

// Custom dropdown to filter by the vault (variable-side) token — the leftmost token on the front page.
export function VaultTokenSelector({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: VaultTokenOption[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  const selected = options.find((o) => o.symbol === value)

  return (
    <div className="chainsel" ref={ref}>
      <button className="chainsel-trigger" onClick={() => setOpen((o) => !o)}>
        {selected ? (
          <>
            <TokenLogo chainId={selected.chainId} address={selected.address} symbol={selected.symbol} size={18} />
            <span>{selected.symbol}</span>
          </>
        ) : (
          <span>All tokens ({options.length})</span>
        )}
        <span className={`chainsel-chev ${open ? 'up' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="chainsel-menu pairsel-menu">
          <button className={`chainsel-item ${value === 'all' ? 'sel' : ''}`} onClick={() => (onChange('all'), setOpen(false))}>
            <span className="chainsel-name">All tokens</span>
            <span className="pairsel-count">{options.length}</span>
            {value === 'all' && <span className="chainsel-check">✓</span>}
          </button>
          {options.map((o) => (
            <button key={o.symbol} className={`chainsel-item ${value === o.symbol ? 'sel' : ''}`} onClick={() => (onChange(o.symbol), setOpen(false))}>
              <TokenLogo chainId={o.chainId} address={o.address} symbol={o.symbol} size={22} />
              <span className="chainsel-name">{o.symbol}</span>
              <span className="pairsel-count">{o.count}</span>
              {value === o.symbol && <span className="chainsel-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
