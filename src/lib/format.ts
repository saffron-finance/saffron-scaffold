import { formatUnits } from 'viem'

// Compact token amount, e.g. 12,345.67 — trims to 2 significant fractional digits for readability.
export function fmtAmount(value: bigint, decimals: number): string {
  const asNumber = Number(formatUnits(value, decimals))
  if (asNumber === 0) return '0'
  if (asNumber < 0.01) return asNumber.toPrecision(2)
  return asNumber.toLocaleString('en-US', { maximumFractionDigits: 2 })
}

export function fmtPct(ratio: number): string {
  return `${(ratio * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
}

// endTime is unix seconds; 0 means the vault has not started yet.
export function fmtCountdown(endTime: number): string {
  if (endTime === 0) return 'not started'
  const secsLeft = endTime - Math.floor(Date.now() / 1000)
  if (secsLeft <= 0) return 'matured'
  const days = Math.floor(secsLeft / 86400)
  const hours = Math.floor((secsLeft % 86400) / 3600)
  if (days > 0) return `${days}d ${hours}h left`
  return `${hours}h left`
}

export function fmtDuration(secs: number): string {
  const days = Math.round(secs / 86400)
  return days >= 1 ? `${days}d` : `${Math.round(secs / 3600)}h`
}

export function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

// unix seconds → "12 Aug 2026" (0 → empty)
export function fmtDate(unixSecs: number): string {
  if (!unixSecs) return ''
  return new Date(unixSecs * 1000).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}
