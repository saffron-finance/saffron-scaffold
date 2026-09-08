/** Prototype asset lookup is presentation-only; contracts come from offer terms. */
export function TokenIcon({ symbol, size = 30 }: { symbol: string; size?: number }) {
  return <img src={`${import.meta.env.BASE_URL}${symbol.toLowerCase()}.${symbol === 'ETH' || symbol === 'USDC' ? 'svg' : 'png'}`} alt='' width={size} height={size}
    style={{ borderRadius: '50%', objectFit: 'contain', flexShrink: 0 }} />
}
