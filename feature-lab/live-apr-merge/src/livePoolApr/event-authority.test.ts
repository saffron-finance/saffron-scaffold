import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { SummaryClient } from './summary-client'
import { fixtureBaseline, fixtureSnapshot, watcher } from './testing/summary-fixtures'
const clients: SummaryClient[] = [], encoder = new TextEncoder()
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(60_000) })
afterEach(() => { clients.splice(0).forEach(client => client.stop(true)); vi.useRealTimers() })
/** Drive the actual fetch-SSE path so parser, validation and state publication
 * are tested together; no direct invocation of a private message handler. */
async function connected() {
  let stream!: ReadableStreamDefaultController<Uint8Array>
  const fetcher = vi.fn(async (url: any) => String(url).endsWith('/events')
    ? new Response(new ReadableStream({ start(c) { stream = c } }), { headers: { 'content-type': 'text/event-stream' } })
    : new Response(JSON.stringify({ sessionId: 's', loadId: 'l', poolId: 'cashcat-eth-1', acceptedAtMs: 1000,
      joinAtMs: 1000, baseline: fixtureBaseline(), watcher, loadDeadlineMs: watcher.loadDeadlineMs, serverTimeMs: Date.now() })))
  const client = new SummaryClient('cashcat-eth-1', { api: '/api', loadId: 'l', fetcher }); clients.push(client); client.start()
  await vi.advanceTimersByTimeAsync(0)
  const send = async (event: string, data: unknown) => {
    stream.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)); await vi.advanceTimersByTimeAsync(0)
  }
  await send('snapshot', fixtureSnapshot(2))
  return { client, send }
}
it('APR-WIRE-008 unsupported schema cannot displace last-good financial state', async () => {
  const f = await connected(), prior = f.client.state.summary
  await f.send('snapshot', { ...fixtureSnapshot(3), schemaVersion: 99 })
  expect(f.client.state.summary).toBe(prior)
})
it('APR-WIRE-020 reset requires bounded dataset epoch and reason before clearing baseline', async () => {
  for (const data of [{}, { datasetGeneration: {}, epoch: '2', reasonCode: 'reset' }, { datasetGeneration: 'new', epoch: '-1', reasonCode: 'reset' }, { datasetGeneration: 'new', epoch: '2', reasonCode: 'x'.repeat(257) }]) {
    const f = await connected(), prior = f.client.state.summary
    await f.send('reset', data); expect(f.client.state.summary).toBe(prior); f.client.stop(true)
  }
})
it('valid explicit epoch reset waits for new baseline and retains displayed results', async () => {
  const f = await connected(), metrics = f.client.state.summary.metrics
  await f.send('reset', { datasetGeneration: 'db-a', epoch: '2', reasonCode: 'accounting_epoch_changed' })
  expect(f.client.state.summary.baseline).toBeNull(); expect(f.client.state.summary.metrics).toBe(metrics)
  expect(f.client.state.summary.waitingForBaseline).toBe(true)
})
it('APR-WIRE-021 unknown status cannot pause or resume an admitted observation', async () => {
  const f = await connected(), prior = f.client.state.summary
  await f.send('status', { state: 'watching', serverTimeMs: Date.now() })
  expect(f.client.state.summary).toBe(prior)
  await f.send('status', { state: 'control_unavailable', serverTimeMs: Date.now() })
  expect(f.client.state.summary.controlUnavailable).toBe(true)
})
it('APR-WIRE-023 heartbeat fields cannot extend the watcher lease or accounting time', async () => {
  const f = await connected(), prior = f.client.state.summary
  await f.send('heartbeat', { serverTimeMs: 'not-a-time', loadDeadlineMs: 9e15 })
  expect(f.client.state.summary).toBe(prior)
  await f.send('heartbeat', { serverTimeMs: Date.now(), loadDeadlineMs: watcher.loadDeadlineMs + 9999999 })
  expect(f.client.state.summary.watcher!.loadDeadlineMs).toBe(watcher.loadDeadlineMs)
  expect(f.client.state.summary.metrics).toBe(prior.metrics)
})
