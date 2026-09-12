import { afterEach, describe, expect, it, vi } from 'vitest'

import { consumeEventStream, SummaryClient } from './summary-client'
import { fixtureBaseline, fixtureSnapshot, watcher } from './testing/summary-fixtures'

const encoder = new TextEncoder()
const turn = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('qualified fetch-SSE parser bounds', () => {
  it('parses split UTF-8, CRLF boundaries, multiline data and named heartbeats', async () => {
    const bytes = encoder.encode(
      '\uFEFF: keep alive\r\nevent: snapshot\r\ndata: {"token":"香",\r\ndata: "ok":true}\r\nid: 42\r\n\r\nevent: heartbeat\ndata: {}\n\n'
    )
    const chunks = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]))
        controller.close()
      },
    })
    const messages: any[] = []
    await expect(
      consumeEventStream(
        new Response(chunks, { headers: { 'Content-Type': 'text/event-stream' } }),
        (event) => messages.push(event),
        new AbortController().signal
      )
    ).rejects.toThrow('ended')
    expect(messages).toHaveLength(2)
    expect(JSON.parse(messages[0].data)).toEqual({ token: '香', ok: true })
    expect(messages[0].id).toBe('42')
    expect(messages[1].event).toBe('heartbeat')
  })
  it('rejects oversized incomplete frames and oversized dispatched snapshots', async () => {
    for (const text of [
      'data: ' + 'x'.repeat(20_000),
      'event: snapshot\ndata: ' + 'x'.repeat(9000) + '\n\n',
    ]) {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(text))
          controller.close()
        },
      })
      await expect(
        consumeEventStream(
          new Response(body, { headers: { 'Content-Type': 'text/event-stream' } }),
          () => {},
          new AbortController().signal
        )
      ).rejects.toThrow(/Oversized|Unterminated/)
    }
  })
})

describe('immutable actual-load receipt and summary transport', () => {
  afterEach(() => {
    vi.useRealTimers()
    sessionStorage.clear()
  })
  it('reuses a load ID on bfcache transport resume, keeps baselines and never admits twice', async () => {
    const calls: { url: string; body: any; method: string; headers: any }[] = []
    const receipt = {
      sessionId: 'session-a',
      loadId: 'document-a',
      poolId: 'cashcat-eth-1',
      acceptedAtMs: 1000,
      loadDeadlineMs: watcher.loadDeadlineMs,
      joinAtMs: 1000,
      baseline: fixtureBaseline(),
      watcher,
      serverTimeMs: 60_000,
    }
    let stream: ReadableStreamDefaultController<Uint8Array> | null = null
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input)
      calls.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : null,
        method: init?.method ?? 'GET',
        headers: init?.headers,
      })
      if (url.endsWith('/events')) {
        const body = new ReadableStream<Uint8Array>({
          start(controller) {
            stream = controller
            controller.enqueue(
              encoder.encode(`event: snapshot\ndata: ${JSON.stringify(fixtureSnapshot(2))}\n\n`)
            )
          },
        })
        return new Response(body, { headers: { 'Content-Type': 'text/event-stream' } })
      }
      return new Response(JSON.stringify(receipt), {
        headers: { 'Content-Type': 'application/json' },
      })
    }) as typeof fetch
    const client = new SummaryClient('cashcat-eth-1', {
      api: '/other/api/live-apr/v2',
      loadId: 'document-a',
      fetcher,
    })
    client.start()
    await turn()
    await turn()
    expect(client.state.summary.metrics?.count).toBe('2')
    client.stop(false)
    client.start()
    await turn()
    await turn()
    expect(calls.filter((call) => call.url.endsWith('/sessions'))).toHaveLength(1)
    expect(calls.filter((call) => call.url.endsWith('/sessions/resume'))).toHaveLength(1)
    expect(
      calls
        .filter((call) => call.url.endsWith('/events'))
        .every((call) => call.headers['X-Session-ID'] === 'session-a')
    ).toBe(true)
    expect(calls.some((call) => /session-a/.test(call.url) && call.url.includes('events'))).toBe(
      false
    )
    expect(client.state.summary.metrics?.count).toBe('2')
    client.stop(true)
    expect(calls.at(-1)?.method).toBe('DELETE')
    client.stop(true)
    expect(calls.filter((call) => call.method === 'DELETE')).toHaveLength(1)
  })
  it('does not promote an unknown recovery receipt into a fresh admission', async () => {
    let resumed = false
    let admissions = 0
    const fetcher = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.endsWith('/sessions/resume')) {
        resumed = true
        return new Response(JSON.stringify({ code: 'paused_requires_reload' }), { status: 409 })
      }
      if (url.endsWith('/sessions')) {
        admissions++
        return new Response(
          JSON.stringify({
            sessionId: 's',
            loadId: 'l',
            poolId: 'cashcat-eth-1',
            acceptedAtMs: 1,
            loadDeadlineMs: watcher.loadDeadlineMs,
            joinAtMs: 1,
            baseline: null,
            watcher,
          })
        )
      }
      return new Response(new ReadableStream({ start() {} }), {
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }) as typeof fetch
    const client = new SummaryClient('cashcat-eth-1', { api: '/api', loadId: 'l', fetcher })
    client.start()
    await turn()
    client.stop(false)
    client.start()
    await turn()
    await turn()
    expect(resumed).toBe(true)
    expect(admissions).toBe(1)
    expect(client.state.needsReload).toBe(true)
    expect(client.state.summary.locallyExpired).toBe(true)
    client.stop(true)
  })
  it('releases an admission that resolves after the user leaves without opening a stream', async () => {
    let resolveAdmission: (response: Response) => void = () => {}
    const calls: string[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${input}`)
      if (String(input).endsWith('/sessions'))
        return new Promise<Response>((resolve) => {
          resolveAdmission = resolve
        })
      return new Response('{}')
    }) as typeof fetch
    const client = new SummaryClient('cashcat-eth-1', { api: '/api', loadId: 'l', fetcher })
    client.start()
    client.stop(true)
    resolveAdmission(
      new Response(
        JSON.stringify({
          sessionId: 's',
          loadId: 'l',
          poolId: 'cashcat-eth-1',
          acceptedAtMs: 1,
          loadDeadlineMs: watcher.loadDeadlineMs,
          joinAtMs: 1,
          baseline: null,
          watcher,
        })
      )
    )
    await turn()
    await turn()
    expect(calls).toEqual(['POST /api/sessions', 'DELETE /api/sessions/s'])
    client.start()
    expect(calls).toHaveLength(2)
  })
})
