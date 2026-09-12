import { describe, expect, it } from 'vitest'

import {
  expireInterest,
  initialSummary,
  metricsFromSnapshot,
  receiveBaseline,
  receiveSnapshot,
  receiveWatcher,
  resetSummary,
  summaryPaused,
} from './summary-session'
import { validSnapshot, validWatcher } from './contracts'

import { Q, watcher, fixtureSnapshot, fixtureBaseline } from './testing/summary-fixtures'

describe('aggregate accounting and two demand clocks', () => {
  it('invalidates valuation without presenting old numbers and recovers only at a new baseline', () => {
    let state = receiveSnapshot(
      receiveBaseline(initialSummary(), fixtureBaseline()),
      fixtureSnapshot(2)
    )
    const invalid = fixtureSnapshot(3, {
      observationAvailable: false,
      valuation: {
        ...fixtureSnapshot().valuation,
        tvlQuoteQ36: null,
        poolPriceValid: false,
        reasonCode: 'no_active_liquidity',
        activeLiquidity: '0',
      },
    })
    expect(validSnapshot(invalid, 'cashcat-eth-1')).toBe(true)
    expect(validSnapshot({ ...invalid, observationAvailable: true }, 'cashcat-eth-1')).toBe(false)
    expect(metricsFromSnapshot(fixtureBaseline(), invalid)).toBeNull()
    state = receiveSnapshot(state, invalid)
    expect(state.valuationReason).toBe('no_active_liquidity')
    const resumed = fixtureSnapshot(4, { epoch: '2' })
    state = receiveSnapshot(state, resumed)
    expect(state.valuationReason).toBe('no_active_liquidity')
    state = receiveBaseline(state, fixtureBaseline(resumed))
    expect(state.valuationReason).toBeNull()
    expect(state.metrics?.count).toBe('0')
    expect(state.metrics?.apr).toBeNull()
  })
  it('does not let a later unpriced snapshot rewrite an already paused observation', () => {
    let state = receiveSnapshot(
      receiveBaseline(initialSummary(), fixtureBaseline()),
      fixtureSnapshot(2)
    )
    state = expireInterest(state, watcher.loadDeadlineMs)
    const prior = state.metrics
    state = receiveSnapshot(
      state,
      fixtureSnapshot(3, {
        observationAvailable: false,
        valuation: {
          ...fixtureSnapshot().valuation,
          tvlQuoteQ36: null,
          poolPriceValid: false,
          reasonCode: 'pool_price_boundary',
        },
      })
    )
    expect(state.valuationReason).toBeNull()
    expect(state.metrics).toBe(prior)
  })
  it('excludes cached history and sums contributions rather than dividing by current TVL', () => {
    const start = fixtureSnapshot()
    const end = fixtureSnapshot(3, {
      valuation: { ...start.valuation, tvlQuoteQ36: String(9000n * Q) },
    })
    let state = receiveSnapshot(initialSummary(), start)
    expect(state.metrics).toBeNull()
    state = receiveBaseline(state, fixtureBaseline(start))
    expect(state.metrics?.count).toBe('0')
    expect(state.metrics?.lastSwapBlock).toBeNull()
    state = receiveSnapshot(state, end)
    expect(state.metrics?.count).toBe('4')
    expect(state.metrics?.feesQuote).toBe(2)
    expect(state.metrics?.apr).toBeCloseTo(((0.002 * 31_536_000) / 60) * 100)
    expect(state.metrics?.tvlUsd).toBe(18_000_000)
  })
  it('subtracts enormous Q36 totals before conversion so tiny session fees survive', () => {
    const start = fixtureSnapshot()
    start.cumulative.lpFeeQuoteQ36 = String(10n ** 80n)
    const end = fixtureSnapshot(2)
    end.cumulative.lpFeeQuoteQ36 = String(10n ** 80n + Q / 10n)
    expect(metricsFromSnapshot(fixtureBaseline(start), end)?.feesQuote).toBe(0.1)
  })
  it('recovers skipped summaries cumulatively and ignores duplicate/out-of-order frames', () => {
    let state = receiveBaseline(initialSummary(), fixtureBaseline())
    state = receiveSnapshot(state, fixtureSnapshot(20))
    expect(state.metrics?.count).toBe('38')
    expect(receiveSnapshot(state, fixtureSnapshot(20))).toBe(state)
    expect(receiveSnapshot(state, fixtureSnapshot(19))).toBe(state)
  })
  it('advances APR on completed empty coverage but not on page timer or deadline checks', () => {
    let state = receiveSnapshot(
      receiveBaseline(initialSummary(), fixtureBaseline()),
      fixtureSnapshot(2)
    )
    const prior = state.metrics
    expect(expireInterest(state, 100_000).metrics).toBe(prior)
    const quiet = fixtureSnapshot(3, {
      cumulative: fixtureSnapshot(2).cumulative,
      lastSwap: fixtureSnapshot(2).lastSwap,
    })
    state = receiveSnapshot(state, quiet)
    expect(state.metrics?.apr).toBeCloseTo(prior!.apr! / 2)
    expect(state.metrics?.lastSwapBlock).toBe('20')
  })
  it('freezes all financial values, quote time and last swap at exactly twenty minutes', () => {
    let state = receiveSnapshot(
      receiveBaseline(initialSummary(), fixtureBaseline()),
      fixtureSnapshot(2)
    )
    expect(summaryPaused(expireInterest(state, watcher.loadDeadlineMs - 1))).toBe(false)
    state = expireInterest(state, watcher.loadDeadlineMs)
    expect(summaryPaused(state)).toBe(true)
    const frozen = state.metrics
    state = receiveSnapshot(
      state,
      fixtureSnapshot(100, {
        valuation: { ...fixtureSnapshot().valuation, quoteUsdQ36: null, quoteValid: false },
      })
    )
    expect(state.metrics).toBe(frozen)
    expect(state.metrics?.quoteTimeMs).toBe(60_000)
  })
  it('rejects old lifecycle status and accepts only a newer shared pool deadline', () => {
    let state = receiveWatcher(initialSummary(), {
      ...watcher,
      statusVersion: '3',
      state: 'paused_recent_load_expired',
    })
    expect(summaryPaused(receiveWatcher(state, watcher))).toBe(true)
    state = receiveWatcher(state, { ...watcher, statusVersion: '4', loadDeadlineMs: 2_401_000 })
    expect(summaryPaused(expireInterest(state, 1_300_000))).toBe(false)
  })
  it.each(['paused_interest_expired', 'paused_recent_load_expired'] as const)(
    'accepts %s and retains financial values across same-receipt resume',
    (expiryState) => {
      let state = receiveSnapshot(
        receiveBaseline(initialSummary(), fixtureBaseline()),
        fixtureSnapshot(4)
      )
      const frozen = state.metrics
      const paused = {
        ...watcher,
        state: expiryState,
        statusVersion: '3',
        pausedAtMs: watcher.loadDeadlineMs,
        pauseReason: 'interest_expired',
      }
      expect(validWatcher(paused)).toBe(true)
      expect(validSnapshot(fixtureSnapshot(5, { watcher: paused }), 'cashcat-eth-1')).toBe(true)
      state = receiveWatcher(state, paused)
      expect(summaryPaused(state)).toBe(true)
      // A resume repeats the same authoritative control and cached accounting. It
      // cannot unpause, move the deadline, or revalue the last coherent result.
      state = receiveWatcher(state, { ...paused })
      state = receiveBaseline(state, fixtureBaseline())
      state = receiveSnapshot(state, fixtureSnapshot(5, { watcher: paused }))
      expect(summaryPaused(state)).toBe(true)
      expect(state.watcher?.loadDeadlineMs).toBe(watcher.loadDeadlineMs)
      expect(state.metrics).toBe(frozen)
    }
  )
  it('retains completed observation results through reset until a new baseline is verified', () => {
    let state = receiveSnapshot(
      receiveBaseline(initialSummary(), fixtureBaseline()),
      fixtureSnapshot(4)
    )
    const prior = state.metrics
    state = resetSummary(state, 'idle_restart', 'db-a')
    expect(state.metrics).toBe(prior)
    const next = fixtureSnapshot(5, { epoch: '2' })
    state = receiveSnapshot(state, next)
    expect(state.metrics).toBe(prior)
    state = receiveBaseline(state, fixtureBaseline(next))
    expect(state.metrics?.count).toBe('0')
    expect(state.metrics?.lastSwapBlock).toBeNull()
    expect(state.notice).toMatch(/New observation/)
  })
  it.each(['baseline-first', 'snapshot-first'])(
    'completes a first-load epoch reset with %s delivery and no retained metrics',
    (order) => {
      // A collector can change epochs while the first viewer is still waiting.
      // Both frame orders must complete the notice even without previous results.
      let state = resetSummary(initialSummary(), 'accounting_epoch_changed', 'db-a', '2')
      const start = fixtureSnapshot(1, { epoch: '2' })
      expect(state.metrics).toBeNull()
      expect(state.notice).toMatch(/is starting/)
      if (order === 'baseline-first') {
        state = receiveBaseline(state, fixtureBaseline(start))
        state = receiveSnapshot(state, start)
      } else {
        state = receiveSnapshot(state, start)
        state = receiveBaseline(state, fixtureBaseline(start))
      }
      expect(state.waitingForBaseline).toBe(false)
      expect(state.metrics?.count).toBe('0')
      expect(state.notice).toBe('New observation started. Unwatched intervals are excluded.')
      // A zero-length interval still cannot be annualized.
      expect(state.metrics?.apr).toBeNull()
      state = receiveSnapshot(state, fixtureSnapshot(2, { epoch: '2' }))
      expect(state.metrics?.count).toBe('2')
      expect(state.metrics?.observedSeconds).toBe(30)
      expect(state.metrics?.apr).toBeGreaterThan(0)
      expect(state.notice).not.toMatch(/starting|waiting/i)
    }
  )
  it('rejects an unannounced dataset namespace and old data after a restore reset', () => {
    let state = receiveSnapshot(
      receiveBaseline(initialSummary(), fixtureBaseline()),
      fixtureSnapshot(4)
    )
    expect(receiveSnapshot(state, fixtureSnapshot(5, { datasetGeneration: 'db-b' }))).toBe(state)
    state = resetSummary(state, 'restore', 'db-b')
    expect(receiveSnapshot(state, fixtureSnapshot(100))).toBe(state)
    const next = fixtureSnapshot(1, { datasetGeneration: 'db-b' })
    state = receiveSnapshot(state, next)
    state = receiveBaseline(state, fixtureBaseline(next))
    expect(state.metrics?.count).toBe('0')
  })
  it('rejects delayed old baselines and snapshots after an announced same-dataset epoch reset', () => {
    let state = receiveSnapshot(
      receiveBaseline(initialSummary(), fixtureBaseline()),
      fixtureSnapshot(4)
    )
    state = resetSummary(state, 'reorg', 'db-a', '2')
    expect(receiveBaseline(state, fixtureBaseline())).toBe(state)
    expect(receiveSnapshot(state, fixtureSnapshot(100))).toBe(state)
    const next = fixtureSnapshot(5, { epoch: '2' })
    state = receiveSnapshot(state, next)
    expect(receiveBaseline(state, fixtureBaseline())).toBe(state)
    state = receiveBaseline(state, fixtureBaseline(next))
    expect(state.metrics?.count).toBe('0')
  })
  it('validates numeric contracts and refuses undeclared negative correction', () => {
    expect(validSnapshot(fixtureSnapshot(), 'cashcat-eth-1')).toBe(true)
    expect(validSnapshot({ ...fixtureSnapshot(), schemaVersion: 1 }, 'cashcat-eth-1')).toBe(false)
    expect(
      validSnapshot(
        { ...fixtureSnapshot(), cumulative: { ...fixtureSnapshot().cumulative, swapCount: 'NaN' } },
        'cashcat-eth-1'
      )
    ).toBe(false)
    expect(
      metricsFromSnapshot(
        fixtureBaseline(fixtureSnapshot(3)),
        fixtureSnapshot(4, { cumulative: fixtureSnapshot(1).cumulative })
      )
    ).toBeNull()
  })
})
