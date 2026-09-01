import { useEffect, useRef, useState } from 'react'
import { TokenLogoPair } from './TokenIcon'

export interface PairOption {
  pair: string
  count: number
  token0?: string
  token1?: string
  chainId: number
}

// Custom pair filter dropdown — each option shows the pair's token icons + name + count, Uniswap-style.
export function PairSelector({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: PairOption[] }) {
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

  const selected = options.find((o) => o.pair === value)
  const total = options.length

  return (
    <div className="chainsel" ref={ref}>
      <button className="chainsel-trigger" onClick={() => setOpen((o) => !o)}>
        {selected ? (
          <>
            <TokenLogoPair
              chainId={selected.chainId}
              a={selected.token0}
              b={selected.token1}
              symbolA={selected.pair.split('/')[0]}
              symbolB={selected.pair.split('/')[1]}
              size={18}
            />
            <span>{selected.pair}</span>
          </>
        ) : (
          <span>All pairs ({total})</span>
        )}
        <span className={`chainsel-chev ${open ? 'up' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="chainsel-menu pairsel-menu">
          <button className={`chainsel-item ${value === 'all' ? 'sel' : ''}`} onClick={() => (onChange('all'), setOpen(false))}>
            <span className="chainsel-name">All pairs</span>
            <span className="pairsel-count">{total}</span>
            {value === 'all' && <span className="chainsel-check">✓</span>}
          </button>
          {options.map((o) => (
            <button key={o.pair} className={`chainsel-item ${value === o.pair ? 'sel' : ''}`} onClick={() => (onChange(o.pair), setOpen(false))}>
              <TokenLogoPair chainId={o.chainId} a={o.token0} b={o.token1} symbolA={o.pair.split('/')[0]} symbolB={o.pair.split('/')[1]} size={22} />
              <span className="chainsel-name">{o.pair}</span>
              <span className="pairsel-count">{o.count}</span>
              {value === o.pair && <span className="chainsel-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
