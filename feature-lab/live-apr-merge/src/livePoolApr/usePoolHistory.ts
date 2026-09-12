import { useEffect, useState } from 'react'
import { summaryPaused } from './summary-session'
import type { HistoryPage } from './contracts'
import type { usePoolObservation } from './usePoolObservation'

/** Fetch history only while visible. Baseline changes invalidate cursors;
 * hidden panels, unmounts and pause boundaries cancel in-flight results. */
export function usePoolHistory(model: ReturnType<typeof usePoolObservation>, collapsed: boolean) {
  const { client, baseline, paused, valuationUnavailable } = model
  const epochKey = baseline ? `${baseline.datasetGeneration}:${baseline.epoch}` : 'pending'
  const [historyOpen, setHistoryOpen] = useState(false)
  const [history, setHistory] = useState<HistoryPage | null>(null)
  const [historyError, setHistoryError] = useState<string | null>(null)
  const [historyCursor, setHistoryCursor] = useState<string | null>(null)
  const [historyBusy, setHistoryBusy] = useState(false)
  const [historyRevision, setHistoryRevision] = useState(0)
  // A new observation cannot reuse an old epoch's pagination cursor or rows.
  useEffect(() => {
    setHistory(null)
    setHistoryCursor(null)
    setHistoryError(null)
  }, [epochKey])
  useEffect(() => {
    if (collapsed || !historyOpen || !client || !baseline || paused || valuationUnavailable) return
    const abort = new AbortController()
    setHistoryBusy(true)
    void client
      .history(historyCursor, abort.signal)
      .then((page) => {
        if (abort.signal.aborted || summaryPaused(client.state.summary)) return
        if (page.epoch !== baseline.epoch) {
          setHistoryError('History is waiting for the new observation.')
          return
        }
        setHistory({
          ...page,
          rows: page.rows.filter((row) => {
            try {
              return BigInt(row.block) > BigInt(baseline.coverage.throughBlock)
            } catch {
              return false
            }
          }),
        })
        setHistoryError(null)
      })
      .catch(() => {
        if (!abort.signal.aborted)
          setHistoryError('Swap history is temporarily unavailable. Metrics keep updating.')
      })
      .finally(() => {
        if (!abort.signal.aborted) setHistoryBusy(false)
      })
    return () => {
      abort.abort()
    }
  }, [
    collapsed,
    historyOpen,
    client,
    baseline?.baselineId,
    epochKey,
    historyCursor,
    historyRevision,
    paused,
    valuationUnavailable,
  ])
  useEffect(() => {
    if (collapsed || !historyOpen || paused || historyCursor !== null) return
    const timer = window.setInterval(() => setHistoryRevision((revision) => revision + 1), 30_000)
    return () => {
      window.clearInterval(timer)
    }
  }, [collapsed, historyOpen, paused, historyCursor])

  return {
    historyOpen,
    setHistoryOpen,
    history,
    historyError,
    historyCursor,
    setHistoryCursor,
    historyBusy,
  }
}
