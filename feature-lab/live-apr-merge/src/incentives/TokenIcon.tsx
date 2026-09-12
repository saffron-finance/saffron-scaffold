import cashcatLogo from './assets/cashcat.jpg'
import ethLogo from './assets/eth.svg'

/** Artwork is optional presentation metadata; unknown catalog tokens get a local fallback. */
export function TokenIcon({ symbol, address, size = 30, compact = false }: { symbol: string; address?: string; size?: number; compact?: boolean }) {
  // The approved phone pair header uses the existing cutout artwork. Token
  // identity still comes from its address; other surfaces retain their image.
  const known: Record<string, string> = {
    '0x020bfc650a365f8bb26819deaabf3e21291018b4': compact ? `${import.meta.env.BASE_URL}cashcat.png` : cashcatLogo,
    '0x0bd7d308f8e1639fab988df18a8011f41eacad73': ethLogo,
  }
  const legacy: Record<string, string> = { CASHCAT: 'cashcat.png', ETH: 'eth.svg', USDC: 'usdc.svg', USDG: 'usdg.png' }
  const src = address ? known[address.toLowerCase()] : Object.hasOwn(legacy, symbol) ? `${import.meta.env.BASE_URL}${legacy[symbol]}` : undefined
  const style = { width: size, height: size, borderRadius: '50%', flexShrink: 0 } as const
  return src ? <img src={src} alt={symbol} width={size} height={size} style={{ ...style, objectFit: 'contain' }} />
    : <span role='img' aria-label={symbol} style={{ ...style, display: 'inline-grid', placeItems: 'center', background: '#30243e', color: '#fff', fontSize: size / 3 }}>{symbol.slice(0, 3)}</span>
}
