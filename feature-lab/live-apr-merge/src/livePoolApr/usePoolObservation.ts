import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { acquirePageEntry } from './summary-client'
import type { ClientState, SummaryClient } from './summary-client'
import { summaryPaused } from './summary-session'
import { connectionStatus } from './connection'

// All visible tiles share one display clock. Protocol leases and stream-health
// clocks remain owned by SummaryClient and never depend on React painting.
let displayNow = Date.now(),
  timer: ReturnType<typeof setInterval> | undefined
const listeners = new Set<() => void>()
function subscribeDisplay(listener: () => void) {
  listeners.add(listener)
  if (!timer) {
    displayNow = Date.now()
    timer = setInterval(() => {
      displayNow = Date.now()
      listeners.forEach((notify) => notify())
    }, 1000)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      clearInterval(timer)
      timer = undefined
    }
  }
}
function useDisplayClock() {
  return useSyncExternalStore(subscribeDisplay, () => displayNow)
}

/** Display-only decay uses verified observed seconds plus local elapsed time.
 * It never modifies the authoritative Q36 ledger, quote or observation window. */
export function interpolateApr(apr: number, observedSeconds: number, elapsedSeconds: number) {
  return (apr * observedSeconds) / (observedSeconds + Math.max(0, Math.floor(elapsedSeconds)))
}

/** Own one route-entry receipt and its projection; rendering/exporting a card
 * never creates a second controller, admission, heartbeat or RPC request. */
export function usePoolObservation(poolId: string, observationKey: string) {
  const [client, setClient] = useState<SummaryClient | null>(null)
  const [view, setView] = useState<ClientState | null>(null)
  const now = useDisplayClock()
  const aprAnchor = useRef<{ metrics: unknown; at: number; active: boolean } | null>(null)
  const [displayApr, setDisplayApr] = useState<number | null>(null)
  const summary = view?.summary
  const metrics = summary?.metrics
  const snapshot = summary?.latest
  const baseline = summary?.baseline
  const paused = Boolean(summary && summaryPaused(summary))
  const transportUnavailable = Boolean(view && (summary?.controlUnavailable ||
    view.health.transportFailedAt !== null || view.health.rpcFailedAt !== null ||
    connectionStatus(view.health, now) === 'Disconnected'))
  const valuationUnavailable = Boolean(summary?.valuationReason)
  const quoteUsd = valuationUnavailable ? null : metrics?.quoteUsd ?? null
  const pageElapsed = client ? Math.max(0, (now - client.openedAt) / 1000) : 0
  const serverNow = now + (view?.serverOffsetMs ?? 0)
  const coverageAge = metrics ? Math.max(0, serverNow - metrics.observedAtMs) : null
  const stale = !valuationUnavailable && coverageAge !== null && (transportUnavailable || (!paused && coverageAge > 30_000))
  const rpcStatus = paused ? 'Paused' : view ? connectionStatus(view.health, now) : 'Connecting'
  const rpcTone: 'connected' | 'offline' | 'pending' =
    rpcStatus === 'Connected' ? 'connected' : rpcStatus === 'Disconnected' ? 'offline' : 'pending'
  const currentBlock =
    (valuationUnavailable ? snapshot?.coverage.throughBlock : metrics?.throughBlock) ?? null
  // Missing quotes after sampling are unavailable, not an endless calculation.
  // Initial 0% is display-only, not recorded accounting. Existing snapshots can
  // supply TVL/a swap before a post-baseline interval is ready; never invent data.
  const hasAprSignal =
    !valuationUnavailable &&
    Boolean(
      (metrics && (metrics.tvlUsd !== null || BigInt(metrics.count) > 0n)) ||
        (snapshot && (BigInt(snapshot.valuation.tvlQuoteQ36 ?? '0') > 0n || snapshot.lastSwap))
    )
  const visibleApr = pageElapsed >= 3 ? displayApr : null
  const loggedStatus = useRef({ page: '', messages: new Set<string>() })

  // Informational observation messages belong in diagnostics, not above APR.
  // Log each distinct message once per page entry, including in StrictMode.
  useEffect(() => {
    const page = `${poolId}:${observationKey}`
    if (loggedStatus.current.page !== page) loggedStatus.current = { page, messages: new Set() }
    const messages = [
      !paused && view?.message,
      summary?.notice?.replaceAll('·', '|'),
      !paused &&
        summary?.waitingForBaseline &&
        'Starting observation. Counting begins at the next verified boundary; earlier swaps are excluded.',
    ]
    for (const message of messages) {
      if (!message || loggedStatus.current.messages.has(message)) continue
      loggedStatus.current.messages.add(message)
      console.info(`[Live APR: ${poolId}] ${message}`)
    }
  }, [poolId, observationKey, paused, view?.message, summary?.notice, summary?.waitingForBaseline])

  useEffect(() => {
    const active = !paused && !stale && !transportUnavailable && !summary?.waitingForBaseline && !valuationUnavailable
    const anchor = aprAnchor.current
    if (!anchor || anchor.metrics !== metrics || anchor.active !== active)
      aprAnchor.current = { metrics, at: Date.now(), active }
    if (valuationUnavailable) {
      setDisplayApr(null)
      return
    }
    if (paused || stale || transportUnavailable) return
    if (summary?.waitingForBaseline) {
      if (hasAprSignal) setDisplayApr((current) => current ?? 0)
      return
    }
    setDisplayApr(
      metrics?.apr != null && metrics.observedSeconds > 0
        ? interpolateApr(metrics.apr, metrics.observedSeconds, (now - aprAnchor.current!.at) / 1000)
        : metrics?.apr ?? (hasAprSignal ? 0 : null)
    )
  }, [metrics, now, paused, stale, summary?.waitingForBaseline, hasAprSignal, valuationUnavailable, transportUnavailable])
  useEffect(() => {
    const entry = acquirePageEntry(poolId, observationKey)
    setClient(entry.client)
    const unsubscribe = entry.client.subscribe(setView)
    return () => {
      unsubscribe()
      entry.release()
    }
  }, [poolId, observationKey])
  return {
    client,
    now,
    summary,
    metrics,
    snapshot,
    baseline,
    paused,
    valuationUnavailable,
    transportUnavailable,
    quoteUsd,
    pageElapsed,
    coverageAge,
    stale,
    rpcStatus,
    rpcTone,
    currentBlock,
    visibleApr,
  }
}
