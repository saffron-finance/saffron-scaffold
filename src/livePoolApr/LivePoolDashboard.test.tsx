import { StrictMode } from 'react'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { MemoryRouter, useLocation, useNavigate } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'
import { afterEach, expect, it, vi } from 'vitest'
import { darkTheme } from 'src/shared/styles/themes/darkTheme'
import { LivePoolDashboard } from './LivePoolDashboard'
import { PoolTilesProvider, usePoolTiles } from './PoolTilesContext'
import { fixtureBaseline, fixtureSnapshot, watcher } from './testing/summary-fixtures'
import { poolPath } from './routing'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'

vi.mock('../PoolPageShell', () => ({
  PoolPageShell: ({ title, children }: any) => (
    <section>
      {title}
      {children}
    </section>
  ),
}))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  sessionStorage.clear()
})

/** Real component + transport fixture verifies that a tile never steals another
 * pool's receipt or resets its metrics, and removal/route exit release demand. */
it('maintains independent tiled observations through add, duplicate, remove, re-add and navigation', async () => {
  const encoder = new TextEncoder()
  const streams = new Map<string, ReadableStreamDefaultController<Uint8Array>>()
  const admissions: any[] = [],
    releases: string[] = []
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input),
        body = init?.body ? JSON.parse(String(init.body)) : null
      if (init?.method === 'DELETE') {
        releases.push(url.split('/').pop()!)
        return new Response('{}')
      }
      if (url.endsWith('/sessions')) {
        admissions.push(body)
        return new Response(
          JSON.stringify({
            ...body,
            sessionId: body.loadId,
            acceptedAtMs: 1000,
            loadDeadlineMs: watcher.loadDeadlineMs,
            joinAtMs: 1000,
            baseline: fixtureBaseline(),
            watcher,
            serverTimeMs: 60000,
          })
        )
      }
      if (url.endsWith('/events')) {
        const poolId = url.split('/').at(-2)!
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              streams.set(poolId, controller)
              controller.enqueue(
                encoder.encode(
                  `event: snapshot\ndata: ${JSON.stringify(fixtureSnapshot(2, { poolId }))}\n\n`
                )
              )
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      throw new Error('unexpected fixture request')
    })
  )
  function Controls() {
    const tiles = usePoolTiles()!,
      navigate = useNavigate(),
      location = useLocation()
    return (
      <>
        <output aria-label='Comparison URL'>{location.search}</output>
        <button onClick={() => tiles.addPool(pools[1].id)}>Add second</button>
        <button onClick={() => tiles.addPool(pools[2].id)}>Add third</button>
        <button onClick={() => navigate('/apps')}>Leave</button>
        {tiles.poolIds.length > 0 && <LivePoolDashboard config={pools[0]} />}
      </>
    )
  }
  const dom = render(
    <StrictMode>
      <MemoryRouter initialEntries={[poolPath(pools[0].id)]}>
        <ThemeProvider theme={darkTheme}>
          <PoolTilesProvider>
            <Controls />
          </PoolTilesProvider>
        </ThemeProvider>
      </MemoryRouter>
    </StrictMode>
  )
  const count = (id: string) =>
    dom.container.querySelector(`[data-pool-id="${id}"] [data-testid="swap-count"]`)?.textContent
  await waitFor(() => expect(count(pools[0].id)).toBe('2'))
  const primaryNode = dom.container.querySelector(`[data-pool-id="${pools[0].id}"]`)
  expect(dom.queryByRole('button', { name: /^(Expand|Collapse) .* details$/ })).toBeNull()
  expect(dom.container.querySelector('[data-testid="pool-details"]')).not.toHaveAttribute('hidden')
  fireEvent.click(dom.getByText('Add second'))
  expect(
    Array.from(dom.container.querySelectorAll('[data-testid="pool-details"]')).every((node) =>
      node.hasAttribute('hidden')
    )
  ).toBe(true)
  const expand = dom.getAllByRole('button', { name: /^Expand .* details$/ })[0]
  expect(expand.textContent).toBe('⛶')
  fireEvent.click(expand)
  expect(
    Array.from(dom.container.querySelectorAll('[data-testid="pool-details"]'))[0]
  ).not.toHaveAttribute('hidden')
  expect(
    Array.from(dom.container.querySelectorAll('[data-testid="pool-details"]'))[1]
  ).toHaveAttribute('hidden')
  const collapse = dom.getByRole('button', { name: /^Collapse .* details$/ })
  expect(collapse.textContent).toBe('−')
  fireEvent.click(collapse)
  expect(
    Array.from(dom.container.querySelectorAll('[data-testid="pool-details"]')).every((node) =>
      node.hasAttribute('hidden')
    )
  ).toBe(true)
  expect(dom.getByRole('button', { name: /^Remove / }).textContent).toBe('×')
  expect(
    Array.from(dom.container.querySelectorAll('[data-testid="pool-status-section"]')).every(
      (node) => !node.hasAttribute('hidden')
    )
  ).toBe(true)
  fireEvent.click(dom.getByText('Add third'))
  expect(
    Array.from(dom.container.querySelectorAll('[data-testid="pool-status-section"]')).every(
      (node) => node.hasAttribute('hidden')
    )
  ).toBe(true)
  fireEvent.click(dom.getAllByRole('button', { name: /^Expand .* details$/ })[0])
  expect(dom.container.querySelector('[data-testid="pool-status-section"]')).not.toHaveAttribute(
    'hidden'
  )
  fireEvent.click(dom.getByRole('button', { name: /^Collapse .* details$/ }))
  await waitFor(() => expect(count(pools[2].id)).toBe('2'))
  expect(dom.getByLabelText('Comparison URL').textContent).toBe(
    `?compare=${pools[1].id}&compare=${pools[2].id}`
  )
  expect(admissions).toHaveLength(3)
  expect(releases).toHaveLength(0)
  expect(dom.container.querySelector(`[data-pool-id="${pools[0].id}"]`)).toBe(primaryNode)
  await act(async () => {
    streams
      .get(pools[1].id)!
      .enqueue(
        encoder.encode(
          `event: snapshot\ndata: ${JSON.stringify(
            fixtureSnapshot(3, { poolId: pools[1].id })
          )}\n\n`
        )
      )
  })
  expect(count(pools[1].id)).toBe('4')
  expect(count(pools[0].id)).toBe('2')
  fireEvent.click(dom.getByText('Add second'))
  expect(admissions).toHaveLength(3)
  fireEvent.click(
    dom.getByRole('button', {
      name: `Remove ${pools[1].name.replace(' | Live APR', '')} from page`,
    })
  )
  await waitFor(() => expect(releases).toEqual([admissions[1].loadId]))
  expect(dom.getByLabelText('Comparison URL').textContent).toBe(`?compare=${pools[2].id}`)
  expect(count(pools[0].id)).toBe('2')
  expect(count(pools[2].id)).toBe('2')
  expect(
    Array.from(dom.container.querySelectorAll('[data-testid="pool-status-section"]')).every(
      (node) => !node.hasAttribute('hidden')
    )
  ).toBe(true)
  fireEvent.click(dom.getByText('Add second'))
  await waitFor(() => expect(admissions).toHaveLength(4))
  expect(admissions[3].loadId).not.toBe(admissions[1].loadId)
  fireEvent.click(dom.getByText('Leave'))
  await waitFor(() => expect(new Set(releases).size).toBe(4))
  expect(dom.container.querySelectorAll('[data-pool-id]')).toHaveLength(0)
})

/** Shared links restore catalog-only ordered comparisons, including on Back. */
it('restores shared comparisons, ignores invalid/duplicate pools, and preserves other parameters', () => {
  function Controls() {
    const tiles = usePoolTiles()!,
      location = useLocation(),
      navigate = useNavigate()
    return (
      <>
        <output aria-label='Selected pools'>{tiles.poolIds.join(',')}</output>
        <output aria-label='URL'>{location.search}</output>
        <button onClick={() => tiles.removePool(pools[1].id)}>Remove</button>
        <button onClick={() => navigate(poolPath(pools[2].id))}>Other base</button>
        <button onClick={() => navigate(-1)}>Back</button>
      </>
    )
  }
  const shared = `${poolPath(pools[0].id)}?view=test&compare=${pools[1].id}&compare=unknown&compare=${pools[1].id}&compare=${pools[0].id}`
  const dom = render(
    <MemoryRouter initialEntries={[shared]}>
      <PoolTilesProvider>
        <Controls />
      </PoolTilesProvider>
    </MemoryRouter>
  )
  expect(dom.getByLabelText('Selected pools').textContent).toBe(`${pools[0].id},${pools[1].id}`)
  fireEvent.click(dom.getByText('Other base'))
  expect(dom.getByLabelText('Selected pools').textContent).toBe(pools[2].id)
  fireEvent.click(dom.getByText('Back'))
  expect(dom.getByLabelText('Selected pools').textContent).toBe(`${pools[0].id},${pools[1].id}`)
  fireEvent.click(dom.getByText('Remove'))
  expect(dom.getByLabelText('Selected pools').textContent).toBe(pools[0].id)
  expect(dom.getByLabelText('URL').textContent).toBe('?view=test')
})

/** Shared URLs cannot bypass the cap; removing a pool frees exactly one slot. */
it('caps shared links and additions at four pools including the base', () => {
  function Controls() {
    const tiles = usePoolTiles()!
    return (
      <>
        <output aria-label='Selected pools'>{tiles.poolIds.join(',')}</output>
        <output aria-label='Can add'>{String(tiles.canAdd)}</output>
        <button onClick={() => tiles.addPool(pools[4].id)}>Fifth</button>
        <button onClick={() => tiles.removePool(pools[1].id)}>Remove second</button>
      </>
    )
  }
  const query = pools
    .slice(1, 6)
    .map((pool) => `compare=${pool.id}`)
    .join('&')
  const dom = render(
    <MemoryRouter initialEntries={[`${poolPath(pools[0].id)}?${query}`]}>
      <PoolTilesProvider>
        <Controls />
      </PoolTilesProvider>
    </MemoryRouter>
  )
  expect(dom.getByLabelText('Selected pools').textContent).toBe(
    pools
      .slice(0, 4)
      .map((pool) => pool.id)
      .join(',')
  )
  expect(dom.getByLabelText('Can add').textContent).toBe('false')
  fireEvent.click(dom.getByText('Fifth'))
  expect(dom.getByLabelText('Selected pools').textContent).toBe(
    pools
      .slice(0, 4)
      .map((pool) => pool.id)
      .join(',')
  )
  fireEvent.click(dom.getByText('Remove second'))
  expect(dom.getByLabelText('Can add').textContent).toBe('true')
  fireEvent.click(dom.getByText('Fifth'))
  expect(dom.getByLabelText('Selected pools').textContent).toBe(
    [pools[0], pools[2], pools[3], pools[4]].map((pool) => pool.id).join(',')
  )
})
