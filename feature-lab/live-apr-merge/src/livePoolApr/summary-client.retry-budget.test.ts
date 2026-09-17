import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SummaryClient } from './summary-client'
import { fixtureBaseline, fixtureSnapshot, watcher } from './testing/summary-fixtures'

const encoder = new TextEncoder(), clients: SummaryClient[] = []
const event = (data: unknown = fixtureSnapshot(2)) => encoder.encode(`event: snapshot\ndata: ${JSON.stringify(data)}\n\n`)
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(60_000); vi.spyOn(Math, 'random').mockReturnValue(0.5) })
afterEach(() => { for (const client of clients.splice(0)) client.stop(true); vi.restoreAllMocks(); vi.useRealTimers() })

/** Deterministic wire fixture exercising the real client/parser, with exactly
 * one admission identity and observable stream owners. No network is used. */
function fixture(open: (signal: AbortSignal, attempt: number) => Response | Promise<Response>) {
  const attempts: number[] = [], controls: string[] = [], signals: AbortSignal[] = []
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).endsWith('/events')) {
      attempts.push(Date.now() - 60_000); signals.push(init!.signal!)
      return open(init!.signal!, attempts.length)
    }
    controls.push(String(input))
    return new Response(JSON.stringify({ sessionId: 's', loadId: 'l', poolId: 'cashcat-eth-1', acceptedAtMs: 1000,
      joinAtMs: 1000, baseline: fixtureBaseline(), watcher, loadDeadlineMs: watcher.loadDeadlineMs, serverTimeMs: Date.now() }))
  }) as typeof fetch
  const client = new SummaryClient('cashcat-eth-1', { api: '/api', loadId: 'l', fetcher }); clients.push(client)
  client.start()
  return { client, attempts, controls, signals }
}
const ended = (text = '') => new Response(text, { headers: { 'content-type': 'text/event-stream' } })

it('APR-HTTP-014 wrong-MIME HTTP 200 preserves exponential failure backoff and closes every body', async () => {
  let cancelled = 0
  const f = fixture(() => new Response(new ReadableStream({ cancel() { cancelled++ } }), { headers: { 'content-type': 'text/html' } }))
  await vi.advanceTimersByTimeAsync(8000)
  expect(f.attempts).toEqual([0, 1000, 3000, 7000]); expect(cancelled).toBe(4)
  expect(f.client.state.health.established).toBe(false)
  expect(f.controls.filter(url => url.endsWith('/sessions'))).toHaveLength(1)
})
it('APR-HTTP-015 immediate EOF does not qualify successful stream headers', async () => {
  const f = fixture(() => ended()); await vi.advanceTimersByTimeAsync(8000)
  expect(f.attempts).toEqual([0, 1000, 3000, 7000]); expect(f.signals.every(signal => signal.aborted)).toBe(true)
})
it('APR-HTTP-016 malformed event JSON does not restart the failure budget', async () => {
  const f = fixture(() => ended('event: snapshot\ndata: {bad\n\n')); await vi.advanceTimersByTimeAsync(8000)
  expect(f.attempts).toEqual([0, 1000, 3000, 7000]); expect(f.client.state.summary.latest).toBeNull()
})
it('APR-HTTP-017 valid events over a five-second healthy interval reset retry budget', async () => {
  let channel!: ReadableStreamDefaultController<Uint8Array>
  const f = fixture((_signal, attempt) => attempt < 3 ? ended() : new Response(new ReadableStream({ start(c) { channel = c; c.enqueue(event()) } }), { headers: { 'content-type': 'text/event-stream' } }))
  await vi.advanceTimersByTimeAsync(3000); expect(f.attempts).toEqual([0, 1000, 3000])
  await vi.advanceTimersByTimeAsync(5000); channel.enqueue(event(fixtureSnapshot(3))); await vi.advanceTimersByTimeAsync(0)
  channel.close(); await vi.advanceTimersByTimeAsync(1000)
  expect(f.attempts).toEqual([0, 1000, 3000, 9000]); expect(f.client.state.summary.metrics?.count).toBe('4')
})
it('APR-HTTP-018 retry growth reaches the documented fifteen-second cap', async () => {
  const f = fixture(() => new Response('', { status: 503 })); await vi.advanceTimersByTimeAsync(60_000)
  expect(f.attempts).toEqual([0, 1000, 3000, 7000, 15000, 30000, 45000, 60000])
})
it('APR-HTTP-019 jitter stays between three-quarters and five-quarters of the bounded delay', async () => {
  // Renewal scheduling also draws jitter; tie the fixture to time, not the
  // incidental number of random draws in another independent timer owner.
  vi.mocked(Math.random).mockImplementation(() => Date.now() === 60_000 ? 0 : 1)
  const f = fixture(() => ended()); await vi.advanceTimersByTimeAsync(4000)
  expect(f.attempts).toEqual([0, 750, 3250])
})
it('APR-HTTP-020 stop removes all clock, renewal and retry owners', async () => {
  const f = fixture(() => ended()); await vi.advanceTimersByTimeAsync(0)
  f.client.stop(true); const count = f.attempts.length; await vi.advanceTimersByTimeAsync(120_000)
  expect(f.attempts).toHaveLength(count); expect(vi.getTimerCount()).toBe(0)
})
it('APR-HTTP-007 stalled stream headers are aborted after fifteen seconds', async () => {
  const f = fixture(signal => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })))
  await vi.advanceTimersByTimeAsync(14999); expect(f.signals[0].aborted).toBe(false)
  await vi.advanceTimersByTimeAsync(1); expect(f.signals[0].aborted).toBe(true)
  await vi.advanceTimersByTimeAsync(1000); expect(f.attempts).toEqual([0, 16000])
})
it('APR-HTTP-008 headers without a qualified body are aborted after fifteen seconds', async () => {
  let cancelled = 0
  const f = fixture(() => new Response(new ReadableStream({ cancel() { cancelled++ } }), { headers: { 'content-type': 'text/event-stream' } }))
  await vi.advanceTimersByTimeAsync(14999); expect(cancelled).toBe(0)
  await vi.advanceTimersByTimeAsync(1); expect(cancelled).toBe(1)
  expect(f.client.state.health.established).toBe(false)
})
it('APR-HTTP-011 a failing reader is cancelled before the next owner is opened', async () => {
  const f = fixture(() => new Response(new ReadableStream({ start(c) { c.error(new Error('Reader disconnected')) } }), { headers: { 'content-type': 'text/event-stream' } }))
  await vi.advanceTimersByTimeAsync(1000)
  expect(f.attempts).toHaveLength(2); expect(f.signals[0].aborted).toBe(true)
})
