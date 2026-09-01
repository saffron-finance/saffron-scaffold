import { useState, useSyncExternalStore, type ReactNode } from 'react'
import { getLogo, setLogo, subscribeLogos } from './logoStore'

// Real token logo by (chainId, address) from DefiLlama's icon service, falling back to the monogram
// coin when the token has no logo. A shared per-symbol store keeps the SAME token rendered
// identically everywhere: the first instance to resolve a real logo records it, and all instances
// (across chains and re-renders) then use that exact URL.
export function TokenLogo({
  chainId,
  address,
  symbol,
  size = 36,
}: {
  chainId: number
  address?: string
  symbol: string
  size?: number
}) {
  const cached = useSyncExternalStore(subscribeLogos, () => getLogo(symbol))
  const [failed, setFailed] = useState(false)
  const url =
    cached ?? (address && chainId ? `https://token-icons.llamao.fi/icons/tokens/${chainId}/${address.toLowerCase()}?h=48&w=48` : undefined)

  if (!url || (failed && !cached)) return <TokenIcon symbol={symbol} size={size} />
  return (
    <img
      className="token-logo"
      style={{ width: size, height: size }}
      src={url}
      onLoad={() => setLogo(symbol, url)}
      onError={() => setFailed(true)}
      alt={symbol}
      title={symbol}
    />
  )
}

// Two overlapping real logos (a pair). If both sides are the same token, render a single icon.
export function TokenLogoPair({
  chainId,
  a,
  b,
  symbolA,
  symbolB,
  size = 36,
}: {
  chainId: number
  a?: string
  b?: string
  symbolA: string
  symbolB: string
  size?: number
}) {
  const same = (a && b && a.toLowerCase() === b.toLowerCase()) || symbolA.toUpperCase() === symbolB.toUpperCase()
  if (same) return <TokenLogo chainId={chainId} address={a} symbol={symbolA} size={size} />
  return (
    <span className="token-pair">
      <TokenLogo chainId={chainId} address={a} symbol={symbolA} size={size} />
      <span style={{ marginLeft: -size * 0.3 }}>
        <TokenLogo chainId={chainId} address={b} symbol={symbolB} size={size} />
      </span>
    </span>
  )
}

// Small chain logo, shown on the bottom-right of a token icon — like Uniswap's explore.
// Ethereum deliberately reuses the exact WETH/Ether token asset used in the vault UI so the
// network and token marks stay visually consistent.
const CHAIN_LOGO_URL: Record<string, string> = {
  ethereum: 'https://token-icons.llamao.fi/icons/tokens/42161/0x82af49447d8a07e3bd95bd0d56f35241523fbab1?h=48&w=48',
  arbitrum: 'https://icons.llamao.fi/icons/chains/rsz_arbitrum.jpg',
  robinhood: 'https://icons.llamao.fi/icons/chains/rsz_robinhood.jpg',
}
export function chainLogoUrl(chainKey: string): string | undefined {
  return CHAIN_LOGO_URL[chainKey]
}
export function ChainBadge({ chainKey, size = 15 }: { chainKey: string; size?: number }) {
  const url = chainLogoUrl(chainKey)
  if (!url) return null
  return (
    <img
      className="chain-badge"
      style={{ width: size, height: size }}
      src={url}
      alt={chainKey}
      title={chainKey}
    />
  )
}

// Wrap a token icon (or pair) and overlay the chain badge at the bottom-right.
export function IconWithChain({ chainKey, badge = 15, children }: { chainKey: string; badge?: number; children: ReactNode }) {
  return (
    <span className="icon-chain">
      {children}
      <ChainBadge chainKey={chainKey} size={badge} />
    </span>
  )
}

// Monogram coin — the design system's default when a token has no bundled logo. A colored disc with
// the symbol's initials, deterministic color per symbol.
function hue(sym: string): number {
  let h = 0
  for (let i = 0; i < sym.length; i++) h = (h * 31 + sym.charCodeAt(i)) % 360
  return h
}

export function TokenIcon({ symbol, size = 36 }: { symbol: string; size?: number }) {
  const s = (symbol || '?').replace(/[^A-Za-z0-9]/g, '')
  const label = s.slice(0, s.length <= 4 ? s.length : 3).toUpperCase()
  const h = hue(s || '?')
  return (
    <span
      className="token-icon"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(135deg, hsl(${h} 55% 42%), hsl(${(h + 40) % 360} 55% 28%))`,
        fontSize: Math.max(8, size * (label.length > 2 ? 0.3 : 0.38)),
      }}
      title={symbol}
    >
      {label}
    </span>
  )
}

// Two overlapping token icons (a pair).
export function TokenPair({ a, b, size = 36 }: { a: string; b: string; size?: number }) {
  return (
    <span className="token-pair">
      <TokenIcon symbol={a} size={size} />
      <span style={{ marginLeft: -size * 0.3 }}>
        <TokenIcon symbol={b} size={size} />
      </span>
    </span>
  )
}
