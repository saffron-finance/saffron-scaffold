import { StrictMode } from 'react'
import { act, cleanup, render } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { ThemeProvider } from 'styled-components'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { darkTheme } from 'src/shared/styles/themes/darkTheme'

import { LivePoolAprPage } from './LivePoolAprPage'
import { fixtureBaseline, fixtureSnapshot, watcher } from './testing/summary-fixtures'

vi.mock('../PoolPageShell', () => ({
  PoolPageShell: ({ title, description, children }: any) => (
    <main>
      {title}
      {description}
      {children}
    </main>
  ),
}))

const encoder = new TextEncoder()

/** Browser-level fixture: the only network boundary is our cached API. No
 * QuickNode, quote API, production listener, or paid load is involved. */
describe('live page aggregate browser contract', () => {
  afterEach(async () => {
    cleanup()
    await Promise.resolve()
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  it('shows APR unavailable during admission failure without inventing zero or another load identity', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(60_000)
    const api=vi.fn(async()=>new Response('{"code":"unavailable"}',{status:503,headers:{'content-type':'application/json'}}))
    vi.stubGlobal('fetch',api)
    const dom=render(<MemoryRouter><ThemeProvider theme={darkTheme}><LivePoolAprPage/></ThemeProvider></MemoryRouter>)
    await act(async()=>{await vi.advanceTimersByTimeAsync(5000)})
    expect(dom.getByTestId('live-apr')).toHaveTextContent('APR unavailable')
    expect(dom.getByTestId('pool-tvl')).toHaveTextContent('Unavailable')
    expect(api.mock.calls.length).toBeGreaterThan(1)
    const admissions=(api.mock.calls as unknown as [string,RequestInit][]).filter(([url])=>url.endsWith('/sessions'))
    expect(new Set(admissions.map(([,options])=>JSON.parse(String(options.body)).loadId)).size).toBe(1)
  })

  it.each([true, false])(
    'hides unpriced values with existing baseline=%s and restores a fresh priced epoch',
    async (hasBaseline) => {
      vi.useFakeTimers()
      vi.setSystemTime(60_000)
      vi.spyOn(console, 'info').mockImplementation(() => {})
      let channel!: ReadableStreamDefaultController<Uint8Array>
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
          if (String(input).endsWith('/events'))
            return new Response(
              new ReadableStream<Uint8Array>({
                start(c) {
                  channel = c
                },
              }),
              { headers: { 'Content-Type': 'text/event-stream' } }
            )
          return new Response(
            JSON.stringify({
              sessionId: 'valuation-test',
              ...JSON.parse(String(options?.body ?? '{}')),
              acceptedAtMs: 1000,
              joinAtMs: 1000,
              loadDeadlineMs: watcher.loadDeadlineMs,
              baseline: hasBaseline ? fixtureBaseline() : null,
              watcher,
              serverTimeMs: Date.now(),
            })
          )
        })
      )
      const dom = render(
        <MemoryRouter>
          <ThemeProvider theme={darkTheme}>
            <LivePoolAprPage />
          </ThemeProvider>
        </MemoryRouter>
      )
      const send = async (event: string, data: unknown) =>
        act(async () => {
          channel.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
        })
      await act(async () => {
        await Promise.resolve()
        await vi.advanceTimersByTimeAsync(3000)
      })
      const value = (id: string) =>
        dom.container.querySelector(`[data-testid="${id}"]`)?.textContent
      if (hasBaseline) {
        await send('snapshot', fixtureSnapshot(2))
        expect(value('pool-tvl')).toBe('$2,000,000')
      }
      await send(
        'snapshot',
        fixtureSnapshot(3, {
          observationAvailable: false,
          valuation: {
            ...fixtureSnapshot().valuation,
            tvlQuoteQ36: null,
            poolPriceValid: false,
            reasonCode: 'no_active_liquidity',
            activeLiquidity: '0',
          },
        })
      )
      await act(async () => {
        await vi.advanceTimersByTimeAsync(35000)
      })
      for (const id of ['live-apr', 'pool-tvl', 'estimated-fees'])
        expect(value(id)).toBe('Unavailable')
      expect(dom.container.querySelector('[data-testid="data-stale"]')).toBeNull()
      expect(dom.getByText('No active liquidity')).toBeInTheDocument()
      const recovered = fixtureSnapshot(4, { epoch: '2' })
      await send('snapshot', recovered)
      expect(value('live-apr')).toBe('Unavailable')
      await send('baseline', fixtureBaseline(recovered))
      expect(value('pool-tvl')).toBe('$2,000,000')
      expect(value('swap-count')).toBe('0')
      expect(value('live-apr')).toBe('0%')
    }
  )

  it('keeps one StrictMode load/stream, collapsed history, observed metrics and a one-second APR estimate', async () => {
    const statusLog = vi.spyOn(console, 'info').mockImplementation(() => {})
    vi.useFakeTimers()
    vi.setSystemTime(60_000)
    const calls: { path: string; method: string; body: any }[] = []
    let channel: ReadableStreamDefaultController<Uint8Array> | null = null
    let loadId = ''
    const api = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
      const path = String(input)
      const body = options?.body ? JSON.parse(String(options.body)) : null
      calls.push({ path, method: options?.method ?? 'GET', body })
      if (path.endsWith('/sessions')) loadId = body.loadId
      if (path.endsWith('/events')) {
        return new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              channel = controller
              controller.enqueue(
                encoder.encode(`event: snapshot\ndata: ${JSON.stringify(fixtureSnapshot(2))}\n\n`)
              )
            },
          }),
          { headers: { 'Content-Type': 'text/event-stream' } }
        )
      }
      if (path.includes('/history'))
        return new Response(
          JSON.stringify({ rows: [], nextCursor: null, retainedFromMs: 0, epoch: '1' })
        )
      return new Response(
        JSON.stringify({
          sessionId: 'fixture-session',
          loadId,
          poolId: 'cashcat-eth-1',
          acceptedAtMs: 1_000,
          loadDeadlineMs: watcher.loadDeadlineMs,
          joinAtMs: 1_000,
          baseline: fixtureBaseline(),
          watcher,
          serverTimeMs: Date.now(),
        })
      )
    })
    vi.stubGlobal('fetch', api)
    const dom = render(
      <StrictMode>
        <MemoryRouter initialEntries={['/apps/live-pool-apr']}>
          <ThemeProvider theme={darkTheme}>
            <LivePoolAprPage />
          </ThemeProvider>
        </MemoryRouter>
      </StrictMode>
    )
    await act(async () => {
      await Promise.resolve()
      await Promise.resolve()
    })
    const get = (name: string) => dom.container.querySelector(`[data-testid="${name}"]`)!
    expect(get('swap-count').textContent).toBe('2')
    expect(calls.filter((call) => call.path.endsWith('/sessions'))).toHaveLength(1)
    expect(calls.filter((call) => call.path.endsWith('/events'))).toHaveLength(1)
    expect(calls.filter((call) => call.path.includes('/history'))).toHaveLength(0)
    expect(get('swap-history-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(get('live-apr').textContent).toContain('Calculating')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2999)
    })
    expect(get('live-apr').textContent).toContain('Calculating')
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    const financial = ['pool-tvl', 'estimated-fees', 'swap-count', 'current-block'].map(
      (name) => get(name).textContent
    )
    const readApr = () => Number(get('live-apr').textContent!.replace(/[,%]/g, ''))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(readApr()).toBe(Math.trunc(((105120 * 30) / 34) * 10) / 10)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000)
    })
    expect(readApr()).toBe(Math.trunc(((105120 * 30) / 35) * 10) / 10)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000)
      channel!.enqueue(encoder.encode('event: heartbeat\ndata: {"serverTimeMs":80000}\n\n'))
    })
    expect(get('page-open-timer').textContent).toBe('0 minutes, 20 seconds')
    expect(
      ['pool-tvl', 'estimated-fees', 'swap-count', 'current-block'].map(
        (name) => get(name).textContent
      )
    ).toEqual(financial)
    // A real snapshot wins immediately; a pause then stops clientside decay.
    await act(async () => {
      channel!.enqueue(
        encoder.encode(`event: snapshot\ndata: ${JSON.stringify(fixtureSnapshot(3))}\n\n`)
      )
    })
    expect(readApr()).toBe(105120)
    expect(get('rpc-status').textContent).toBe('Connected')
    await act(async () => {
      ;(get('swap-history-toggle') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(calls.filter((call) => call.path.includes('/history'))).toHaveLength(1)
    expect(get('swap-history-toggle')).toHaveAttribute('aria-expanded', 'true')
    await act(async () => {
      ;(get('swap-history-toggle') as HTMLButtonElement).click()
      await Promise.resolve()
    })
    expect(get('swap-history-toggle')).toHaveAttribute('aria-expanded', 'false')
    expect(
      calls.every(
        (call) => !call.path.includes('quicknode') && !call.path.includes('saffron-staging.xyz')
      )
    ).toBe(true)
    await act(async () => {
      channel!.enqueue(
        encoder.encode(
          `event: watcher_status\ndata: ${JSON.stringify({
            ...watcher,
            state: 'paused_interest_expired',
            statusVersion: '2',
            pausedAtMs: 80000,
            pauseReason: 'interest_expired',
          })}\n\n`
        )
      )
    })
    // The status banner is gone; clock ticks and repeated snapshots do not spam logs.
    expect(get('observation-notice')).toBeNull()
    expect(get('observation-starting')).toBeNull()
    expect(dom.container.textContent).not.toContain('New observation started.')
    const messages = statusLog.mock.calls.map((call) => call[0])
    expect(messages.length).toBeGreaterThan(0)
    expect(new Set(messages).size).toBe(messages.length)
    expect(dom.container.textContent).not.toContain('Data observed through')
    expect(get('coverage-time')).toBeNull()
    expect(get('tracking-paused').textContent).toContain(
      'Tracking paused—refresh to resume. Last observed values are retained. Refresh page'
    )
    expect(
      get('current-block').compareDocumentPosition(get('tracking-paused')) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    const pausedApr = get('live-apr').textContent
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000)
    })
    expect(get('live-apr').textContent).toBe(pausedApr)
    dom.unmount()
    await act(async () => {
      await Promise.resolve()
    })
    expect(calls.at(-1)?.method).toBe('DELETE')
  })
  it.each(['tvl', 'tvl-without-usd', 'swap'])(
    'shows initial zero after %s arrives, then measured APR without new requests',
    async (signal) => {
      vi.useFakeTimers()
      vi.setSystemTime(30_000)
      let channel!: ReadableStreamDefaultController<Uint8Array>
      const api = vi.fn(async (input: RequestInfo | URL, options?: RequestInit) => {
        if (String(input).endsWith('/events'))
          return new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                channel = controller
              },
            }),
            { headers: { 'Content-Type': 'text/event-stream' } }
          )
        const body = JSON.parse(String(options?.body ?? '{}'))
        return new Response(
          JSON.stringify({
            sessionId: 'fixture',
            loadId: body.loadId,
            poolId: 'cashcat-eth-1',
            acceptedAtMs: 30_000,
            joinAtMs: 30_000,
            loadDeadlineMs: watcher.loadDeadlineMs,
            baseline: fixtureBaseline(),
            watcher,
            serverTimeMs: Date.now(),
          })
        )
      })
      vi.stubGlobal('fetch', api)
      const dom = render(
        <MemoryRouter>
          <ThemeProvider theme={darkTheme}>
            <LivePoolAprPage />
          </ThemeProvider>
        </MemoryRouter>
      )
      await act(async () => {
        await Promise.resolve()
        await Promise.resolve()
      })
      const apr = () => dom.container.querySelector('[data-testid="live-apr"]')!.textContent!
      await act(async () => {
        await vi.advanceTimersByTimeAsync(4000)
      })
      expect(apr()).toContain('Calculating') // Three seconds alone must not invent data.
      const initial =
        signal === 'tvl'
          ? fixtureSnapshot()
          : signal === 'tvl-without-usd'
          ? fixtureSnapshot(1, {
              valuation: { ...fixtureSnapshot().valuation, quoteUsdQ36: null, quoteValid: false },
            })
          : fixtureSnapshot(2, {
              coverage: fixtureSnapshot().coverage,
              valuation: {
                ...fixtureSnapshot().valuation,
                tvlQuoteQ36: '1',
                quoteUsdQ36: null,
                quoteValid: false,
              },
            })
      await act(async () => {
        channel.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(initial)}\n\n`))
      })
      expect(apr()).toBe('0%')
      expect(
        dom.getByText(signal === 'swap' ? 'Estimated LP fee yield' : 'Waiting for swaps')
      ).toBeInTheDocument()
      if (signal !== 'swap') {
        // An empty verified interval yields measured zero, but still awaits a swap.
        const quiet = fixtureSnapshot(2, {
          cumulative: fixtureSnapshot().cumulative,
          lastSwap: null,
          coverage: { ...fixtureSnapshot(2).coverage, chainTimeMs: 35_000 },
        })
        await act(async () => {
          channel.enqueue(
            encoder.encode('event: snapshot\ndata: ' + JSON.stringify(quiet) + '\n\n')
          )
        })
        expect(apr()).toBe('0%')
        expect(dom.getByText('Waiting for swaps')).toBeInTheDocument()
      }
      const observed = fixtureSnapshot(3, {
        coverage: { ...fixtureSnapshot(3).coverage, chainTimeMs: 35_000 },
      })
      await act(async () => {
        channel.enqueue(encoder.encode(`event: snapshot\ndata: ${JSON.stringify(observed)}\n\n`))
      })
      expect(Number(apr().replace(/[,%]/g, ''))).toBeGreaterThan(0)
      expect(dom.getByText('Estimated LP fee yield')).toBeInTheDocument()
      expect(api).toHaveBeenCalledTimes(2) // Existing session + stream only.
    }
  )
})
