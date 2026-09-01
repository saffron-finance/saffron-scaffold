import { useEffect, useRef, useState } from 'react'
import { CHAINS } from '../chain/chains'
import { chainLogoUrl } from './TokenIcon'

const OPTIONS = [{ key: 'all', label: 'All networks' }, ...CHAINS.map((c) => ({ key: c.key, label: c.label }))]

function ChainLogo({ chainKey, size }: { chainKey: string; size: number }) {
  const url = chainLogoUrl(chainKey)
  if (!url) return null
  return <img className="chainsel-logo" style={{ width: size, height: size }} src={url} alt={chainKey} />
}

// The multi-chain "All networks" mark — the chain logos fanned out, like Uniswap.
function AllLogo() {
  return (
    <span className="chainsel-all">
      {CHAINS.map((c, i) => (
        <span key={c.key} style={{ marginLeft: i === 0 ? 0 : -7 }}>
          <ChainLogo chainKey={c.key} size={15} />
        </span>
      ))}
    </span>
  )
}

// Custom chain selector modeled on Uniswap's explore network dropdown.
export function ChainSelector({ value, onChange }: { value: string; onChange: (v: string) => void }) {
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

  const current = OPTIONS.find((o) => o.key === value) ?? OPTIONS[0]

  return (
    <div className="chainsel" ref={ref}>
      <button className="chainsel-trigger" onClick={() => setOpen((o) => !o)}>
        {value === 'all' ? <AllLogo /> : <ChainLogo chainKey={value} size={18} />}
        <span>{current.label}</span>
        <span className={`chainsel-chev ${open ? 'up' : ''}`}>▾</span>
      </button>
      {open && (
        <div className="chainsel-menu">
          {OPTIONS.map((o) => (
            <button key={o.key} className={`chainsel-item ${value === o.key ? 'sel' : ''}`} onClick={() => (onChange(o.key), setOpen(false))}>
              {o.key === 'all' ? <AllLogo /> : <ChainLogo chainKey={o.key} size={22} />}
              <span className="chainsel-name">{o.label}</span>
              {value === o.key && <span className="chainsel-check">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
