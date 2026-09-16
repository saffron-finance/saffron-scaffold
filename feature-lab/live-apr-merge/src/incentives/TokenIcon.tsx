import { tokenArtwork } from './tokenArtwork'

/** Artwork is optional presentation metadata; unknown catalog tokens get a local fallback. */
export function TokenIcon({ symbol, address, size = 30, compact = false }: { symbol: string; address?: string; size?: number; compact?: boolean }) {
  const src=tokenArtwork(symbol,address,compact)
  const style = { width: size, height: size, borderRadius: '50%', flexShrink: 0 } as const
  return src ? <img data-token-icon={symbol} data-token-size={size} data-token-compact={compact||undefined} src={src} alt={symbol} width={size} height={size} style={{ ...style, objectFit: 'contain' }} />
    : <span data-token-icon={symbol} data-token-size={size} data-token-compact={compact||undefined} role='img' aria-label={symbol} style={{ ...style, display: 'inline-grid', placeItems: 'center', background: '#30243e', color: '#fff', fontSize: size / 3 }}>{symbol.slice(0, 3)}</span>
}
