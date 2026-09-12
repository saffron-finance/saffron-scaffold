import type { Baseline, Snapshot, WatcherStatus } from './contracts'

export interface SessionMetrics {
  count: string
  feesQuote: number
  feeReturn: number
  apr: number | null
  tvlUsd: number | null
  feesUsd: number | null
  quoteUsd: number | null
  quoteTimeMs: number | null
  observedSeconds: number
  observedAtMs: number
  observationStartedAtMs: number
  throughBlock: string
  lastSwapBlock: string | null
  epoch: string
}
export interface SummarySession {
  baseline: Baseline | null
  latest: Snapshot | null
  watcher: WatcherStatus | null
  metrics: SessionMetrics | null
  notice: string | null
  waitingForBaseline: boolean
  allowedDataset: string | null
  minimumEpoch: string | null
  locallyExpired: boolean
  controlUnavailable: boolean
  valuationReason: string | null
}
export function initialSummary(): SummarySession {
  return {
    baseline: null,
    latest: null,
    watcher: null,
    metrics: null,
    notice: null,
    waitingForBaseline: true,
    allowedDataset: null,
    minimumEpoch: null,
    locallyExpired: false,
    controlUnavailable: false,
    valuationReason: null,
  }
}

/** Convert only a final Q36 amount; differences are computed as exact integers. */
export function q36Number(value: string | bigint): number {
  return Number(`${value}e-36`)
}
export function watcherPaused(watcher: WatcherStatus | null): boolean {
  return Boolean(watcher && !['starting', 'watching'].includes(watcher.state))
}
export function summaryPaused(state: SummarySession): boolean {
  return state.locallyExpired || state.controlUnavailable || watcherPaused(state.watcher)
}

/** The observation clock is committed chain time, never page time or heartbeat time. */
export function metricsFromSnapshot(baseline: Baseline, latest: Snapshot): SessionMetrics | null {
  if (latest.valuation.poolPriceValid === false || latest.valuation.tvlQuoteQ36 === null)
    return null
  if (
    baseline.datasetGeneration !== latest.datasetGeneration ||
    baseline.epoch !== latest.epoch ||
    BigInt(latest.sequence) < BigInt(baseline.sequence)
  )
    return null
  const count = BigInt(latest.cumulative.swapCount) - BigInt(baseline.cumulative.swapCount)
  const fee = BigInt(latest.cumulative.lpFeeQuoteQ36) - BigInt(baseline.cumulative.lpFeeQuoteQ36)
  const feeReturn =
    BigInt(latest.cumulative.feeReturnQ36) - BigInt(baseline.cumulative.feeReturnQ36)
  const seconds = (latest.coverage.chainTimeMs - baseline.coverage.chainTimeMs) / 1000
  // A negative cumulative difference indicates an undeclared correction: fail closed.
  if (count < 0n || fee < 0n || feeReturn < 0n || seconds < 0) return null
  const quote =
    latest.valuation.quoteValid && latest.valuation.quoteUsdQ36 !== null
      ? q36Number(latest.valuation.quoteUsdQ36)
      : null
  return {
    count: count.toString(),
    feesQuote: q36Number(fee),
    feeReturn: q36Number(feeReturn),
    // Any positive verified interval supports an APR; the page owns its short
    // loading minimum. Never annualize against a zero-length chain interval.
    apr: seconds > 0 ? ((q36Number(feeReturn) * 31_536_000) / seconds) * 100 : null,
    tvlUsd: quote === null ? null : q36Number(latest.valuation.tvlQuoteQ36) * quote,
    feesUsd: quote === null ? null : q36Number(fee) * quote,
    quoteUsd: quote,
    quoteTimeMs: latest.valuation.quoteTimeMs,
    observedSeconds: seconds,
    observedAtMs: latest.coverage.chainTimeMs,
    observationStartedAtMs: baseline.coverage.chainTimeMs,
    // Keep the displayed scan boundary frozen with the other accepted metrics.
    throughBlock: latest.coverage.throughBlock,
    lastSwapBlock: count > 0n ? latest.lastSwap?.block ?? null : null,
    epoch: latest.epoch,
  }
}

/** Lifecycle versions are independent of financial sequences, preventing delayed
 * control frames or embedded old watcher state from undoing an intentional pause. */
export function receiveWatcher(previous: SummarySession, watcher: WatcherStatus): SummarySession {
  if (previous.watcher && BigInt(watcher.statusVersion) <= BigInt(previous.watcher.statusVersion))
    return previous
  return { ...previous, watcher, locallyExpired: false }
}

/** Expire precisely on the server-owned deadline using the server-clock offset.
 * Financial values and their valuation time remain the exact last coherent result. */
export function expireInterest(previous: SummarySession, serverNowMs: number): SummarySession {
  return previous.watcher &&
    previous.watcher.loadDeadlineMs > 0 &&
    serverNowMs >= previous.watcher.loadDeadlineMs &&
    !previous.locallyExpired
    ? { ...previous, locallyExpired: true }
    : previous
}

/** Explicit reset authorizes a new dataset/epoch but retains old results while
 * a verified new post-join baseline is being obtained. */
export function resetSummary(
  previous: SummarySession,
  reason: string,
  dataset?: string,
  epoch?: string
): SummarySession {
  const changedDataset = Boolean(dataset && dataset !== previous.allowedDataset)
  return {
    ...previous,
    baseline: null,
    latest: null,
    waitingForBaseline: true,
    allowedDataset: dataset ?? previous.allowedDataset,
    minimumEpoch: epoch ?? (changedDataset ? null : previous.minimumEpoch),
    watcher: changedDataset ? null : previous.watcher,
    notice: `A new observation is starting (${reason.replaceAll(
      '_',
      ' '
    )}). Previous results remain below until it is ready.`,
  }
}

export function receiveBaseline(previous: SummarySession, baseline: Baseline): SummarySession {
  if (previous.allowedDataset && previous.allowedDataset !== baseline.datasetGeneration)
    return previous
  if (previous.minimumEpoch && BigInt(baseline.epoch) < BigInt(previous.minimumEpoch))
    return previous
  if (previous.baseline) {
    if (previous.baseline.baselineId === baseline.baselineId) return previous
    if (
      previous.baseline.datasetGeneration === baseline.datasetGeneration &&
      BigInt(baseline.epoch) <= BigInt(previous.baseline.epoch)
    )
      return previous
  }
  const same =
    previous.latest?.datasetGeneration === baseline.datasetGeneration &&
    previous.latest.epoch === baseline.epoch
  const metrics = same && previous.latest ? metricsFromSnapshot(baseline, previous.latest) : null
  return {
    ...previous,
    baseline,
    allowedDataset: baseline.datasetGeneration,
    minimumEpoch: baseline.epoch,
    valuationReason: !summaryPaused(previous) && metrics ? null : previous.valuationReason,
    metrics: !summaryPaused(previous) && metrics ? metrics : previous.metrics,
    waitingForBaseline: !metrics,
    notice:
      metrics && previous.metrics?.epoch !== baseline.epoch
        ? 'New observation started. Unwatched intervals are excluded.'
        : previous.notice,
  }
}

export function receiveSnapshot(previous: SummarySession, snapshot: Snapshot): SummarySession {
  if (previous.allowedDataset && previous.allowedDataset !== snapshot.datasetGeneration)
    return previous
  if (previous.minimumEpoch && BigInt(snapshot.epoch) < BigInt(previous.minimumEpoch))
    return previous
  if (
    previous.latest &&
    (BigInt(snapshot.epoch) < BigInt(previous.latest.epoch) ||
      (snapshot.epoch === previous.latest.epoch &&
        BigInt(snapshot.sequence) <= BigInt(previous.latest.sequence)))
  )
    return previous
  let state = receiveWatcher(previous, snapshot.watcher)
  if (state.baseline && BigInt(snapshot.epoch) > BigInt(state.baseline.epoch)) {
    state = resetSummary(
      state,
      'accounting epoch changed',
      snapshot.datasetGeneration,
      snapshot.epoch
    )
  }
  state = {
    ...state,
    latest: snapshot,
    allowedDataset: snapshot.datasetGeneration,
    minimumEpoch: snapshot.epoch,
  }
  if (summaryPaused(state)) return state
  // Retain past accounting internally, but explicitly hide financial displays
  // until a valid recovery baseline exists. Paused observations remain frozen.
  if (snapshot.valuation.poolPriceValid === false)
    return { ...state, valuationReason: snapshot.valuation.reasonCode ?? 'pool_price_boundary' }
  if (!snapshot.observationAvailable || !state.baseline) return state
  const metrics = metricsFromSnapshot(state.baseline, snapshot)
  if (!metrics)
    return {
      ...state,
      notice: 'Waiting for a verified accounting boundary. Last results are retained.',
    }
  // A first-load reset can have no retained metrics. Its pending notice still
  // completes when the first coherent baseline/snapshot pair is promoted.
  return {
    ...state,
    metrics,
    waitingForBaseline: false,
    valuationReason: null,
    notice:
      state.waitingForBaseline && state.notice
        ? 'New observation started. Unwatched intervals are excluded.'
        : state.notice,
  }
}
