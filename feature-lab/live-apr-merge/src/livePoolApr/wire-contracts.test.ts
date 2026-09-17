import { expect, it } from 'vitest'
import { validSnapshot, validWatcher } from './contracts'
import { formatTimestamp } from './time'
import { initialSummary, receiveBaseline, receiveSnapshot, metricsFromSnapshot } from './summary-session'
import { fixtureBaseline, fixtureSnapshot, watcher } from './testing/summary-fixtures'

const pool = 'cashcat-eth-1', maxTime = 8_640_000_000_000_000
// Each row isolates a different trust field; variants within a row are one
// contract, not a multiplication of the published coverage count.
it('APR-WIRE-001 rejects non-object snapshots without throwing', () => {
  for (const value of [null, undefined, true, 7, 'snapshot', [], {}]) expect(validSnapshot(value, pool)).toBe(false)
})
it('APR-WIRE-002 requires every identity field', () => {
  for (const key of ['schemaVersion', 'poolId', 'chainId', 'datasetGeneration', 'epoch', 'sequence']) {
    const snapshot: any = fixtureSnapshot(); delete snapshot[key]; expect(validSnapshot(snapshot, pool)).toBe(false)
  }
})
it('APR-WIRE-003 validates cumulative dimensions independently', () => {
  for (const key of ['swapCount', 'lpFeeQuoteQ36', 'feeReturnQ36']) {
    const snapshot: any = fixtureSnapshot(); snapshot.cumulative[key] = 'bad'; expect(validSnapshot(snapshot, pool)).toBe(false)
  }
})
it('APR-WIRE-004 accepts exact 128-digit cumulative integers unchanged', () => {
  const snapshot = fixtureSnapshot(); snapshot.cumulative.lpFeeQuoteQ36 = '9'.repeat(128)
  expect(validSnapshot(snapshot, pool)).toBe(true); expect(snapshot.cumulative.lpFeeQuoteQ36).toHaveLength(128)
})
it('APR-WIRE-005 rejects integer strings beyond 128 digits', () => {
  const snapshot = fixtureSnapshot(); snapshot.cumulative.lpFeeQuoteQ36 = '9'.repeat(129)
  expect(validSnapshot(snapshot, pool)).toBe(false)
})
it('APR-WIRE-006 rejects signed fractional exponent and padded unsigned accounting', () => {
  for (const value of ['-1', '+1', '1.2', '1e3', ' 1', '01']) {
    const snapshot = fixtureSnapshot(); snapshot.cumulative.swapCount = value; expect(validSnapshot(snapshot, pool)).toBe(false)
  }
})
it('rejects nonfinite diagnostic lag and preserves a finite funded interval', () => {
  for (const value of [NaN, Infinity, -Infinity]) {
    const snapshot = fixtureSnapshot(); snapshot.quality.lagMs = value; expect(validSnapshot(snapshot, pool)).toBe(false)
  }
  expect(Number.isFinite(metricsFromSnapshot(fixtureBaseline(), fixtureSnapshot(2))!.apr)).toBe(true)
})
it('APR-WIRE-009 stale snapshots cannot rewind accepted accounting', () => {
  const state = receiveSnapshot(receiveBaseline(initialSummary(), fixtureBaseline()), fixtureSnapshot(5))
  expect(receiveSnapshot(state, fixtureSnapshot(4))).toBe(state)
})
it.each([
  ['APR-WIRE-010', 'coverage', 'chainTimeMs'], ['APR-WIRE-011', 'lastSwap', 'chainTimeMs'],
  ['APR-WIRE-012', 'valuation', 'quoteTimeMs'], ['APR-WIRE-013', 'watcher', 'loadDeadlineMs'],
  ['APR-WIRE-014', 'watcher', 'pausedAtMs'],
])('%s rejects unsupported dates in %s.%s', (_id, group, field) => {
  const snapshot: any = structuredClone(fixtureSnapshot(2)); snapshot[group][field] = maxTime + 1
  expect(validSnapshot(snapshot, pool)).toBe(false)
})
it('APR-WIRE-015 accepts exact maximum representable Date', () => {
  const snapshot = structuredClone(fixtureSnapshot(2)); snapshot.coverage.chainTimeMs = maxTime
  expect(validSnapshot(snapshot, pool)).toBe(true); expect(formatTimestamp(maxTime)).toContain('275760')
})
it('APR-WIRE-016 retained unsupported dates render Unavailable', () => {
  for (const time of [-1, maxTime + 1, NaN, Infinity, 'today', null]) expect(formatTimestamp(time)).toBe('Unavailable')
})
it('APR-WIRE-018 rejects another pool even when other accounting fields match', () => {
  expect(validSnapshot(fixtureSnapshot(), 'nvda-usdg-005')).toBe(false)
})
it('APR-WIRE-019 rejects another chain for a catalog-pinned pool', () => {
  expect(validSnapshot(fixtureSnapshot(2, { chainId: '1' }), pool)).toBe(false)
})
it('APR-WIRE-022 oversized snapshots never qualify for publication', () => {
  expect(validSnapshot({ ...fixtureSnapshot(), padding: 'x'.repeat(8192) }, pool)).toBe(false)
})
it('APR-WIRE-024 diagnostic fields are bounded before display retention', () => {
  const snapshot = fixtureSnapshot(); snapshot.quality.reasonCode = 'x'.repeat(1024)
  expect(validSnapshot(snapshot, pool)).toBe(false)
})
it('watcher status is a closed discriminator and cannot carry a fractional lease version', () => {
  expect(validWatcher({ ...watcher, state: 'pretend-active' })).toBe(false)
  expect(validWatcher({ ...watcher, statusVersion: '1.5' })).toBe(false)
})
