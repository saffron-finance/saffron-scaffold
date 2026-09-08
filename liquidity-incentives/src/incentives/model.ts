import type { IncentiveRequestTerms, RequestDetails } from '@receipt'

/** Offer terms are static prototypes, not funded or deployed vault balances. */
const CASHCAT = { address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4', symbol: 'CASHCAT', decimals: 18 } as const
const ETH = { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'ETH', decimals: 18 } as const
export interface Offer {
  id: string
  chainId: number
  pool: `0x${string}`
  feeTier?: number
  token0: IncentiveRequestTerms['token0']
  token1: IncentiveRequestTerms['token1']
  apr: number
  days: number
  capacityUsd: number
}

/** This page offers one pool. Retired USDG receipts still render their own
 * immutable metadata through offerFromRequest, never through this catalog. */
export const INCENTIVE_PAIR = {
  chainId: 4663, pool: '0xA70fc67C9F69da90B63a0e4C05D229954574E313',
  feeTier: 10000, token0: CASHCAT, token1: ETH,
} as const

/** Shared pair metadata is defined once; adding another term is a single row. */
function offer(apr: number, days: number): Offer {
  return {
    ...INCENTIVE_PAIR, id: `cashcat-eth-${apr}-${days}d`, apr, days, capacityUsd: 100000,
  }
}
export const OFFERS = [offer(1000, 3), offer(800, 2), offer(1200, 14), offer(2400, 90)]
export interface PriceSnapshot { quotePerToken: number; quoteUsd: number; observedAt: string; block: string }

/** Full-range indicative quote; no rounded display value becomes calldata. */
export function requestDraft(offer: Offer, depositUsd: string, price: PriceSnapshot): RequestDetails {
  const principal = Number(depositUsd)
  const cashcatUsd = price.quotePerToken * price.quoteUsd
  const rewardUsd = principal * offer.apr / 100 * offer.days / 365
  return {
    version: 3, kind: 'incentive', chain: 'robinhood', depositToken: 'USD',
    pair: `${offer.token0.symbol} / ${offer.token1.symbol}`, depositAmount: depositUsd,
    incentive: {
      id: offer.id, chainId: offer.chainId, poolAddress: offer.pool, feeTier: offer.feeTier,
      token0: offer.token0, token1: offer.token1, durationDays: offer.days,
      capacityUsd: offer.capacityUsd, aprPercent: offer.apr, depositUsd, range: 'full',
      quote: { cashcatAmount: principal / 2 / cashcatUsd, quoteAmount: principal / 2 / price.quoteUsd,
        rewardUsd, rewardCashcat: rewardUsd / cashcatUsd, cashcatUsd,
        quoteTokenUsd: price.quoteUsd, quotePerCashcat: price.quotePerToken, quotedAt: price.observedAt },
    },
  }
}

/** Magnitude-based display only. Raw signed amounts remain unchanged. */
export function tokenAmount(value: number) {
  return Number.isFinite(value) ? value.toLocaleString('en-US', {
    maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : value >= 1 ? 2 : 4,
  }) : '—'
}
export const usd = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const compactUsd = (value: number) => value.toLocaleString('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 })

/** Display stored USD input without rounding legacy receipt precision away. */
export function exactUsd(value: string) {
  if (!/^\d+(\.\d+)?$/.test(value)) return usd(Number(value))
  const [whole, fraction = ''] = value.split('.')
  return `$${BigInt(whole).toLocaleString('en-US')}.${fraction.padEnd(2, '0')}`
}

/** Unpaid reviews expire; an already paid receipt always keeps its old quote. */
export function freshQuote(quotedAt: string | undefined, now = Date.now()) {
  const age = now - Date.parse(quotedAt ?? '')
  return Number.isFinite(age) && age >= -60_000 && age < 120_000
}

/** Resume rendering does not depend on the current offer catalog still existing. */
export function offerFromRequest(request: RequestDetails): Offer {
  const t = request.incentive!
  return { id: t.id, chainId: t.chainId, pool: t.poolAddress, feeTier: t.feeTier,
    token0: t.token0, token1: t.token1,
    apr: t.aprPercent, days: t.durationDays, capacityUsd: t.capacityUsd }
}
