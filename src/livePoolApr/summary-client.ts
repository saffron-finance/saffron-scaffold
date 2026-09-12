import { createParser } from './vendor/eventsource-parser'
import { validBaseline, validSnapshot, validWatcher } from './contracts'
import { initialConnection, loseConnection, receiveConnection } from './connection'
import {
  expireInterest,
  initialSummary,
  receiveBaseline,
  receiveSnapshot,
  receiveWatcher,
  resetSummary,
} from './summary-session'

import type { Baseline, HistoryPage, Receipt, WatcherStatus } from './contracts'
import type { ConnectionHealth } from './connection'
import type { SummarySession } from './summary-session'

declare global {
  interface Window {
    __SAFFRON_LIVE_APR__?: { apiBase?: string }
  }
}

/** Hosting is replaceable: runtime override wins over build config, and the
 * default API stays beneath the configured app base without a hostname. */
export function liveAprApiBase(): string {
  const configured = window.__SAFFRON_LIVE_APR__?.apiBase ?? import.meta.env.VITE_LIVE_APR_API_BASE
  return (configured ?? `${import.meta.env.BASE_URL.replace(/\/$/, '')}/api/live-apr/v2`).replace(
    /\/$/,
    ''
  )
}

export interface StreamMessage {
  event: string
  data: string
  id?: string
}

/** Decode UTF-8 incrementally and let the vendored, qualified WHATWG parser
 * handle CR/LF, multiline events, comments, IDs and chunk-boundary framing.
 * Bound bytes since dispatch as well as event payloads to stop incomplete-frame
 * memory growth. A parser rejection aborts this stream and retains last values. */
export async function consumeEventStream(
  response: Response,
  onMessage: (message: StreamMessage) => void,
  signal: AbortSignal
) {
  if (!response.body || !response.headers.get('content-type')?.includes('text/event-stream'))
    throw new Error('Invalid event stream')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let undispatchedBytes = 0
  let first = true
  const parser = createParser({
    onEvent(event) {
      if (new TextEncoder().encode(event.data).byteLength > 8192)
        throw new Error('Oversized summary')
      undispatchedBytes = 0
      onMessage({ ...event, event: event.event ?? 'message' })
    },
    onComment() {
      undispatchedBytes = 0
    },
    // Unknown SSE fields are valid extensions; malformed retries are ignored by
    // the standard parser. Application reconnect timing is locally bounded.
  })
  const abort = () => {
    void reader.cancel().catch(() => {})
  }
  signal.addEventListener('abort', abort, { once: true })
  try {
    while (!signal.aborted) {
      const part = await reader.read()
      if (part.done) break
      // Feed bounded pieces so one network read may contain many valid frames.
      for (let offset = 0; offset < part.value.byteLength; offset += 1024) {
        const bytes = part.value.subarray(offset, offset + 1024)
        undispatchedBytes += bytes.byteLength
        if (undispatchedBytes > 16_384) throw new Error('Unterminated event stream frame')
        let text = decoder.decode(bytes, { stream: true })
        if (first && text) {
          text = text.replace(/^\uFEFF/, '')
          first = false
        }
        parser.feed(text)
      }
    }
    decoder.decode()
    if (!signal.aborted) throw new Error('Event stream ended')
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}

export interface ClientState {
  summary: SummarySession
  health: ConnectionHealth
  receipt: Receipt | null
  message: string | null
  needsReload: boolean
  serverOffsetMs: number
}
class ApiError extends Error {
  constructor(readonly status: number, readonly code: string) {
    super(code)
  }
}

/** One controller belongs to one real route entry/document load—not to a React
 * effect. Reconnect, focus, StrictMode and bfcache reuse its immutable load ID. */
export class SummaryClient {
  readonly loadId: string
  readonly openedAt = Date.now()
  readonly poolId: string
  private readonly api: string
  private readonly fetcher: typeof fetch
  private listeners = new Set<(value: ClientState) => void>()
  private controller: AbortController | null = null
  private streamAbort: AbortController | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private renewTimer: ReturnType<typeof setTimeout> | null = null
  private clockTimer: ReturnType<typeof setInterval> | null = null
  private attempts = 0
  private admitted = false
  private ended = false
  private releaseSent = false
  private registering: Promise<Receipt> | null = null
  private baselineStorageKey: string
  private value: ClientState

  constructor(
    poolId: string,
    options: { api?: string; fetcher?: typeof fetch; loadId?: string } = {}
  ) {
    this.poolId = poolId
    this.loadId = options.loadId ?? crypto.randomUUID()
    this.api = options.api ?? liveAprApiBase()
    this.fetcher = options.fetcher ?? fetch.bind(window)
    this.baselineStorageKey = `saffron-live-apr-v2:${this.loadId}`
    this.value = {
      summary: initialSummary(),
      health: initialConnection(Date.now()),
      receipt: null,
      message: null,
      needsReload: false,
      serverOffsetMs: 0,
    }
  }

  get state(): ClientState {
    return this.value
  }
  subscribe(listener: (value: ClientState) => void): () => void {
    this.listeners.add(listener)
    listener(this.value)
    return () => {
      this.listeners.delete(listener)
    }
  }
  private publish(patch: Partial<ClientState>) {
    this.value = { ...this.value, ...patch }
    for (const listener of this.listeners) listener(this.value)
  }
  private serverClock(serverTimeMs: unknown) {
    if (typeof serverTimeMs === 'number' && Number.isSafeInteger(serverTimeMs)) {
      this.publish({ serverOffsetMs: serverTimeMs - Date.now() })
    }
  }
  private persistBaseline(baseline: Baseline) {
    try {
      sessionStorage.setItem(this.baselineStorageKey, JSON.stringify(baseline))
    } catch {
      /* Private modes may disable storage. The in-memory baseline remains valid. */
    }
  }
  private restoreBaseline() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(this.baselineStorageKey) ?? 'null')
      if (validBaseline(saved))
        this.publish({ summary: receiveBaseline(this.value.summary, saved) })
    } catch {
      /* Corrupt tab-local state cannot authorize a baseline. */
    }
  }

  /** Called only by the page-entry owner. Retried uncertain admissions retain
   * this same load ID; an admitted session thereafter uses resume exclusively. */
  start() {
    if (this.controller || this.ended || this.value.needsReload) return
    this.controller = new AbortController()
    this.restoreBaseline()
    // A suspended document may return long after its deadline. Render the
    // known pause before waiting for the first timer tick or network response.
    this.publish({
      summary: expireInterest(this.value.summary, Date.now() + this.value.serverOffsetMs),
    })
    this.clockTimer = setInterval(() => {
      this.publish({
        summary: expireInterest(this.value.summary, Date.now() + this.value.serverOffsetMs),
      })
      // A silent stream is closed and recovered without recording a page load.
      if (Date.now() - this.value.health.lastMessageAt > 35_000) this.streamAbort?.abort()
    }, 1000)
    void this.connect()
  }

  /** bfcache/background transport suspension retains provenance and baseline;
   * a real route departure uses release=true and is terminal for this entry. */
  stop(release = false) {
    if (release) this.ended = true
    this.controller?.abort()
    this.controller = null
    this.streamAbort?.abort()
    this.streamAbort = null
    if (this.retryTimer) clearTimeout(this.retryTimer)
    if (this.renewTimer) clearTimeout(this.renewTimer)
    if (this.clockTimer) clearInterval(this.clockTimer)
    this.retryTimer = this.renewTimer = this.clockTimer = null
    if (this.ended && this.value.receipt && !this.releaseSent) {
      this.releaseSent = true
      void this.fetcher(
        `${this.api}/sessions/${encodeURIComponent(this.value.receipt.sessionId)}`,
        {
          method: 'DELETE',
          credentials: 'same-origin',
          keepalive: true,
        }
      ).catch(() => {})
      try {
        sessionStorage.removeItem(this.baselineStorageKey)
      } catch {
        /* No secret or durable user record is stored here. */
      }
    }
  }

  /** JSON control requests are bounded and never include session data in URLs
   * except the non-credential REST resource identifier required by the API. */
  private async json(path: string, init: RequestInit, signal?: AbortSignal): Promise<any> {
    const deadline = new AbortController()
    const timer = setTimeout(() => deadline.abort(), 15_000)
    const cancel = () => deadline.abort()
    signal?.addEventListener('abort', cancel, { once: true })
    if (signal?.aborted) deadline.abort()
    try {
      const response = await this.fetcher(`${this.api}${path}`, {
        ...init,
        credentials: 'same-origin',
        signal: deadline.signal,
        headers: { 'Content-Type': 'application/json', ...init.headers },
      })
      const text = await response.text()
      if (new TextEncoder().encode(text).byteLength > 32_768)
        throw new Error('Oversized control response')
      const data = text ? JSON.parse(text) : {}
      if (!response.ok) throw new ApiError(response.status, data.code ?? 'service_unavailable')
      this.serverClock(data.serverTimeMs)
      return data
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
    }
  }

  private acceptReceipt(data: Receipt) {
    if (
      !data ||
      data.poolId !== this.poolId ||
      data.loadId !== this.loadId ||
      typeof data.sessionId !== 'string' ||
      !validWatcher(data.watcher) ||
      (data.baseline !== null && !validBaseline(data.baseline))
    ) {
      throw new Error('Incompatible session contract')
    }
    this.admitted = true
    let summary = receiveWatcher(this.value.summary, data.watcher)
    if (data.baseline) {
      if (
        data.baseline.coverage.headSelectedAtMs < data.joinAtMs ||
        data.baseline.coverage.chainTimeMs < data.joinAtMs
      ) {
        throw new Error('Baseline predates page observation')
      }
      summary = receiveBaseline(summary, data.baseline)
      this.persistBaseline(data.baseline)
    }
    this.publish({ receipt: data, summary, message: null })
    // If a real route closed while admission was in flight, release its receipt
    // as soon as it becomes known. It never acquires a stream in the meantime.
    if (this.ended) this.stop(true)
  }

  private async connect() {
    const owner = this.controller
    if (!owner || owner.signal.aborted || this.value.needsReload) return
    try {
      // Concurrent StrictMode stop/start shares a pending first admission.
      if (!this.admitted) {
        this.registering ??= this.json('/sessions', {
          method: 'POST',
          body: JSON.stringify({ poolId: this.poolId, loadId: this.loadId }),
        }).finally(() => {
          this.registering = null
        })
        this.acceptReceipt(await this.registering)
      } else {
        this.acceptReceipt(
          await this.json(
            '/sessions/resume',
            {
              method: 'POST',
              body: JSON.stringify({
                poolId: this.poolId,
                loadId: this.loadId,
                sessionId: this.value.receipt?.sessionId,
              }),
            },
            owner.signal
          )
        )
      }
      if (this.controller !== owner || owner.signal.aborted) return
      const stream = new AbortController()
      this.streamAbort = stream
      const cancel = () => stream.abort()
      owner.signal.addEventListener('abort', cancel, { once: true })
      this.scheduleRenew()
      try {
        const response = await this.fetcher(
          `${this.api}/pools/${encodeURIComponent(this.poolId)}/events`,
          {
            signal: stream.signal,
            credentials: 'same-origin',
            headers: { Accept: 'text/event-stream', 'X-Session-ID': this.value.receipt!.sessionId },
          }
        )
        if (!response.ok)
          throw new ApiError(
            response.status,
            response.status === 409 ? 'paused_requires_reload' : 'stream_unavailable'
          )
        this.publish({
          health: receiveConnection(this.value.health, Date.now(), { ready: true, error: null }),
          message: null,
        })
        this.attempts = 0
        await consumeEventStream(response, (event) => this.message(event), stream.signal)
      } finally {
        owner.signal.removeEventListener('abort', cancel)
      }
    } catch (error) {
      if (this.controller !== owner || owner.signal.aborted) return
      if (error instanceof ApiError && [401, 403, 404, 409, 410].includes(error.status)) {
        this.publish({
          needsReload: true,
          message:
            error.status === 401 || error.status === 403
              ? 'Authentication required. Refresh this page after signing in.'
              : 'Tracking paused—refresh to resume.',
          summary: { ...this.value.summary, locallyExpired: true },
        })
        return
      }
      this.publish({ health: loseConnection(this.value.health, Date.now()) })
    }
    if (this.controller === owner && !owner.signal.aborted && !this.value.needsReload) {
      const delay =
        Math.min(15_000, 1000 * 2 ** Math.min(this.attempts++, 4)) * (0.75 + Math.random() * 0.5)
      this.retryTimer = setTimeout(() => {
        void this.connect()
      }, delay)
    }
  }

  /** Handle only known, validated events. Heartbeats advance transport time,
   * never the accounting/quote clock or the paid-interest deadline. */
  private message(event: StreamMessage) {
    const data = JSON.parse(event.data)
    this.serverClock(data.serverTimeMs)
    let summary = this.value.summary
    if (event.event === 'snapshot') {
      if (!validSnapshot(data, this.poolId)) throw new Error('Incompatible snapshot contract')
      summary = receiveSnapshot(summary, data)
    } else if (event.event === 'baseline') {
      if (!validBaseline(data)) throw new Error('Incompatible baseline contract')
      if (
        (data.poolId && data.poolId !== this.poolId) ||
        (this.value.receipt &&
          (data.coverage.headSelectedAtMs < this.value.receipt.joinAtMs ||
            data.coverage.chainTimeMs < this.value.receipt.joinAtMs))
      ) {
        throw new Error('Baseline predates page observation')
      }
      summary = receiveBaseline(summary, data)
      if (summary.baseline?.baselineId === data.baselineId) this.persistBaseline(data)
    } else if (event.event === 'watcher_status') {
      if (!validWatcher(data)) throw new Error('Incompatible watcher contract')
      if (
        !data.datasetGeneration ||
        !summary.allowedDataset ||
        data.datasetGeneration === summary.allowedDataset
      ) {
        summary = receiveWatcher(summary, data)
      }
    } else if (event.event === 'reset') {
      summary = resetSummary(
        summary,
        data.reasonCode ?? 'verified accounting reset',
        data.datasetGeneration,
        typeof data.epoch === 'string' && /^\d+$/.test(data.epoch) ? data.epoch : undefined
      )
      try {
        sessionStorage.removeItem(this.baselineStorageKey)
      } catch {
        /* Next baseline replaces the retained state. */
      }
    } else if (
      event.event === 'status' &&
      ['control_unavailable', 'control_recovered'].includes(data.state)
    ) {
      // Dependency failure is an explicit temporary pause, not a new load and
      // not a broken transport. Only the server can clear this condition.
      summary = { ...summary, controlUnavailable: data.state === 'control_unavailable' }
    }
    this.publish({
      summary: expireInterest(summary, Date.now() + this.value.serverOffsetMs),
      health: receiveConnection(this.value.health, Date.now(), { ready: true, error: null }),
    })
  }

  private scheduleRenew() {
    if (this.renewTimer) clearTimeout(this.renewTimer)
    this.renewTimer = setTimeout(() => {
      const owner = this.controller
      if (!owner || !this.value.receipt || this.value.needsReload) return
      void this.json(
        `/sessions/${encodeURIComponent(this.value.receipt.sessionId)}/renew`,
        {
          method: 'POST',
          body: JSON.stringify({
            baselineId: this.value.summary.baseline?.baselineId,
            sequence: this.value.summary.latest?.sequence,
          }),
        },
        owner.signal
      )
        .then((data) => {
          if (validWatcher(data.watcher))
            this.publish({ summary: receiveWatcher(this.value.summary, data.watcher) })
        })
        .catch((error) => {
          if (error instanceof ApiError && [409, 410].includes(error.status)) {
            this.publish({
              needsReload: true,
              message: 'Tracking paused—refresh to resume.',
              summary: { ...this.value.summary, locallyExpired: true },
            })
            this.streamAbort?.abort()
          }
        })
        .finally(() => {
          if (this.controller === owner && !this.value.needsReload) this.scheduleRenew()
        })
    }, 27_000 + Math.random() * 3000)
  }

  /** Optional history never creates demand and is fetched only by the expanded
   * panel. A caller-owned AbortSignal cancels collapse and route changes. */
  async history(cursor: string | null, signal: AbortSignal): Promise<HistoryPage> {
    const receipt = this.value.receipt
    if (!receipt) throw new Error('Observation has not started')
    const data = await this.json(
      `/pools/${encodeURIComponent(this.poolId)}/history${
        cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
      }`,
      {
        method: 'GET',
        headers: { 'X-Session-ID': receipt.sessionId },
      },
      signal
    )
    if (!Array.isArray(data.rows) || data.rows.length > 20 || typeof data.epoch !== 'string')
      throw new Error('Invalid history page')
    if (
      new TextEncoder().encode(JSON.stringify(data)).byteLength > 16_384 ||
      data.rows.some(
        (row: any) =>
          !row ||
          typeof row.id !== 'string' ||
          !/^\d+$/.test(String(row.block)) ||
          !Number.isSafeInteger(row.timestamp) ||
          row.timestamp < 0 ||
          typeof row.transactionHash !== 'string' ||
          !/^0x[\da-f]{64}$/i.test(row.transactionHash) ||
          typeof row.inputIs0 !== 'boolean' ||
          !/^\d{1,128}$/.test(row.lpFeeQuoteQ36) ||
          !/^\d{1,128}$/.test(row.feeReturnQ36) ||
          (row.inputAmount !== undefined &&
            (!Number.isFinite(Number(row.inputAmount)) || Number(row.inputAmount) < 0))
      )
    ) {
      throw new Error('Invalid history rows')
    }
    return data
  }
}

// Each visible pool owns a separate client; tile changes never stop siblings.
const activeEntries = new Map<
  string,
  { client: SummaryClient; readers: number; releaseRevision: number }
>()

/** Acquire only from a mounted pool route, never from catalog/search/prefetch.
 * Cleanup is microtask-delayed so React StrictMode's synthetic remount cannot
 * register a second page load, release presence, or open two transports. */
export function acquirePageEntry(
  poolId: string,
  routeKey: string
): { client: SummaryClient; release: () => void } {
  const key = JSON.stringify([routeKey, poolId])
  let entry = activeEntries.get(key)
  if (!entry) {
    entry = { client: new SummaryClient(poolId), readers: 0, releaseRevision: 0 }
    activeEntries.set(key, entry)
  }
  entry.readers++
  entry.releaseRevision++
  entry.client.start()
  return {
    client: entry.client,
    release() {
      entry.readers--
      const revision = ++entry.releaseRevision
      queueMicrotask(() => {
        if (!entry.readers && entry.releaseRevision === revision) {
          entry.client.stop(true)
          if (activeEntries.get(key) === entry) activeEntries.delete(key)
        }
      })
    },
  }
}

// Document lifecycle is distinct from React lifecycle. bfcache restoration
// reuses the exact load receipt and may resume only if the server recognizes it.
if (typeof window !== 'undefined') {
  window.addEventListener('pagehide', (event) => {
    for (const entry of activeEntries.values()) entry.client.stop(!event.persisted)
  })
  window.addEventListener('pageshow', (event) => {
    if (event.persisted) for (const entry of activeEntries.values()) entry.client.start()
  })
}
