import { encodeAbiParameters } from 'viem'

// Test-owned metadata; the application reads its catalog exclusively from PostgreSQL.
export const PAIR = { id: 'cashcat-eth', revision: 1, chainId: 4663,
  pool: '0xa70fc67c9f69da90b63a0e4c05d229954574e313', feeTier: 10000, active: true,
  token0: { address: '0x020bfc650a365f8bb26819deaabf3e21291018b4', symbol: 'CASHCAT', decimals: 18 },
  token1: { address: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', symbol: 'ETH', decimals: 18 } }
export const OFFER = { ...PAIR, id: 'cashcat-eth-1000-3d', pairId: PAIR.id, apr: 1000, days: 3,
  capacityUsd: 100000, sortOrder: 0, isNew: true }
export function requestDetails() {
  return { version: 3, kind: 'incentive', chain: 'robinhood', depositToken: 'USD', pair: 'CASHCAT / ETH', depositAmount: '100',
    incentive: { id: OFFER.id, chainId: 4663, poolAddress: PAIR.pool, feeTier: PAIR.feeTier,
      token0: { ...PAIR.token0 }, token1: { ...PAIR.token1 }, durationDays: 3, capacityUsd: 100000, aprPercent: 1000,
      depositUsd: '100', range: 'full', quote: { cashcatAmount: 25000, quoteAmount: 0.025, rewardUsd: 100 * 10 * 3 / 365,
        rewardCashcat: 100 * 10 * 3 / 365 / 0.002, cashcatUsd: 0.002, quoteTokenUsd: 2000,
        quotePerCashcat: 0.000001, quotedAt: new Date().toISOString() } } }
}
export function catalogRpc(pairs = [PAIR]) {
  const encode = (type, value) => encodeAbiParameters([{ type }], [value])
  return async (method, params) => {
    if (method === 'eth_chainId') return '0x1237'
    if (method === 'eth_blockNumber') return '0x64'
    if (method === 'eth_call') {
      const pair = pairs.find(value => value.pool.toLowerCase() === params[0].to.toLowerCase())
      if (pair && params[0].data === '0x0dfe1681') return encode('address', pair.token0.address)
      if (pair && params[0].data === '0xd21220a7') return encode('address', pair.token1.address)
      if (pair && params[0].data === '0xddca3f43') return encode('uint24', pair.feeTier)
      const token = pairs.flatMap(value => [value.token0, value.token1]).find(value => value.address.toLowerCase() === params[0].to.toLowerCase())
      if (token && params[0].data === '0x313ce567') return encode('uint8', token.decimals)
    }
    throw new Error('Unexpected catalog fixture read')
  }
}
