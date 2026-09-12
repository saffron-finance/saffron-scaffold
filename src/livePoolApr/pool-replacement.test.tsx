import { cleanup, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { afterEach, expect, it, vi } from 'vitest'
import { usePoolTiles } from './PoolTilesContext'
import LivePoolAprRoute from './LivePoolAprRoute'
import { FIXED_INCOME_APR_PATH, STAGING_APR_PATH, poolAtPath, poolPath } from './routing'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'

vi.mock('./PoolPicker', () => ({ PoolPicker: () => null }))
vi.mock('./LivePoolDashboard', () => ({
  LivePoolDashboard: () => {
    const location = useLocation(),
      tiles = usePoolTiles()!
    return (
      <output>
        {JSON.stringify({ path: location.pathname, hash: location.hash, ids: tiles.poolIds })}
      </output>
    )
  },
}))
afterEach(cleanup)

it.each([STAGING_APR_PATH, FIXED_INCOME_APR_PATH, ''])(
  'preserves aliases, comparisons and fragments under %s',
  async (basePath) => {
    const dom = render(
      <MemoryRouter
        initialEntries={[
          `${basePath}/zzz-eth-005?compare=zzz-eth-005&compare=zzz-eth-1&compare=cashcat-eth-1#fees`,
        ]}
      >
        <LivePoolAprRoute basePath={basePath} />
      </MemoryRouter>
    )
    await waitFor(() =>
      expect(JSON.parse(dom.container.querySelector('output')!.textContent!)).toEqual({
        path: `${basePath}/zzz-eth-1`,
        hash: '#fees',
        ids: ['zzz-eth-1', 'cashcat-eth-1'],
      })
    )
  }
)
it('all catalog identities round trip at both hosts and unknown addresses remain unwatched', () => {
  for (const base of [STAGING_APR_PATH, FIXED_INCOME_APR_PATH, ''])
    for (const pool of pools) expect(poolAtPath(poolPath(pool.id, base), base)?.id).toBe(pool.id)
  expect(poolAtPath('/apps/live-pool-apr/not-indexed')).toBeNull()
})

it('opens NVDA/USDG 0.05% by default without removing explicit CASHCAT links', () => {
  expect(poolAtPath(STAGING_APR_PATH)?.id).toBe('nvda-usdg-005')
  expect(poolAtPath(STAGING_APR_PATH + '/cashcat-eth-1')?.id).toBe('cashcat-eth-1')
})
