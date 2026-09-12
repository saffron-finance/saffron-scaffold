/** Public wire contract. Integer accounting is Q36, rounded toward zero once per
 * arithmetic operation; it never passes through JavaScript floating point. */
export const Q36 = 10n ** 36n
export const MAX_SNAPSHOT_BYTES = 8192
const integer = (value) => typeof value === 'string' && /^(0|[1-9][0-9]{0,127})$/.test(value)

/** Convert a decimal input (including scientific notation) to exact Q36. Values
 * with more than 36 decimal places are deliberately truncated toward zero. */
export function decimalQ36(value) {
  const match = String(value).match(/^([+-]?)(\d+)(?:\.(\d*))?(?:e([+-]?\d+))?$/i)
  if (!match) throw new Error('invalid_decimal')
  const decimals = match[3] ?? '',
    exponent = Number(match[4] ?? 0)
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 200)
    throw new Error('decimal_capacity')
  const raw = BigInt(match[2] + decimals),
    power = 36 + exponent - decimals.length
  return (
    (match[1] === '-' ? -1n : 1n) *
    (power >= 0 ? raw * 10n ** BigInt(power) : raw / 10n ** BigInt(-power))
  )
}

/** Validate every accounting and ordering field, plus the hard fanout limit. */
export function validateSnapshot(snapshot) {
  if (
    snapshot?.schemaVersion !== 2 ||
    !/^[a-z0-9-]+$/.test(snapshot.poolId) ||
    !snapshot.datasetGeneration ||
    !integer(snapshot.chainId) ||
    !integer(snapshot.epoch) ||
    !integer(snapshot.sequence)
  )
    throw new Error('snapshot_identity')
  for (const key of ['swapCount', 'lpFeeQuoteQ36', 'feeReturnQ36']) {
    if (!integer(snapshot.cumulative?.[key])) throw new Error('snapshot_accounting')
  }
  for (const key of ['fromBlock', 'throughBlock'])
    if (!integer(snapshot.coverage?.[key])) throw new Error('snapshot_coverage')
  if (
    BigInt(snapshot.coverage.fromBlock) > BigInt(snapshot.coverage.throughBlock) ||
    !/^0x[0-9a-f]{64}$/i.test(snapshot.coverage.blockHash)
  )
    throw new Error('snapshot_coverage')
  for (const key of ['chainTimeMs', 'headSelectedAtMs', 'committedAtMs']) {
    if (!Number.isSafeInteger(snapshot.coverage[key]) || snapshot.coverage[key] < 0)
      throw new Error('snapshot_time')
  }
  const valuation = snapshot.valuation
  const unavailable = valuation?.poolPriceValid === false
  // Null is allowed only with an explicit failure and unavailable observation.
  // It must never masquerade as either a valid zero TVL or a healthy snapshot.
  if (
    (unavailable
      ? valuation.tvlQuoteQ36 !== null ||
        snapshot.observationAvailable !== false ||
        !['no_active_liquidity', 'pool_price_boundary'].includes(valuation.reasonCode)
      : !integer(valuation?.tvlQuoteQ36) || BigInt(valuation.tvlQuoteQ36) <= 0n) ||
    (valuation?.poolPriceValid != null && typeof valuation.poolPriceValid !== 'boolean') ||
    (valuation?.activeLiquidity != null && !integer(valuation.activeLiquidity)) ||
    !integer(snapshot.valuation.block) ||
    (snapshot.valuation.quoteUsdQ36 !== null && !integer(snapshot.valuation.quoteUsdQ36))
  )
    throw new Error('snapshot_valuation')
  if (
    snapshot.lastSwap &&
    (!integer(snapshot.lastSwap.block) ||
      !Number.isSafeInteger(snapshot.lastSwap.chainTimeMs) ||
      !/^0x[0-9a-f]{64}$/i.test(snapshot.lastSwap.blockHash))
  )
    throw new Error('snapshot_last_swap')
  if (!integer(snapshot.watcher?.runGeneration) || !integer(snapshot.watcher?.statusVersion))
    throw new Error('snapshot_control')
  if (
    !coverage(snapshot.coverage) ||
    !validWatcher(snapshot.watcher) ||
    typeof snapshot.valuation.method !== 'string' ||
    (snapshot.valuation.quoteTimeMs !== null && !timestamp(snapshot.valuation.quoteTimeMs)) ||
    typeof snapshot.valuation.quoteValid !== 'boolean' ||
    typeof snapshot.observationAvailable !== 'boolean' ||
    !object(snapshot.history) ||
    !object(snapshot.quality) ||
    typeof snapshot.quality.state !== 'string' ||
    !Number.isFinite(snapshot.quality.lagMs)
  )
    throw new Error('snapshot_shape')
  const encoded = JSON.stringify(snapshot)
  if (new TextEncoder().encode(encoded).byteLength > MAX_SNAPSHOT_BYTES)
    throw new Error('snapshot_capacity')
  return encoded
}

/** Ordered versions only have meaning inside their database restore namespace. */
export function compareVersion(left, right) {
  if (left.datasetGeneration !== right.datasetGeneration) throw new Error('dataset_mismatch')
  for (const key of ['epoch', 'sequence']) {
    const delta = BigInt(left[key]) - BigInt(right[key])
    if (delta !== 0n) return delta > 0n ? 1 : -1
  }
  return 0
}

/** Browser-safe guards share the exact producer validator. No Node polyfills. */
const timestamp = (value) => Number.isSafeInteger(value) && value >= 0
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
function cumulative(value) {
  return (
    object(value) &&
    ['swapCount', 'lpFeeQuoteQ36', 'feeReturnQ36'].every((key) => integer(value[key]))
  )
}
function coverage(value) {
  return (
    object(value) &&
    integer(value.fromBlock) &&
    integer(value.throughBlock) &&
    BigInt(value.fromBlock) <= BigInt(value.throughBlock) &&
    /^0x[0-9a-f]{64}$/i.test(value.blockHash) &&
    ['chainTimeMs', 'headSelectedAtMs', 'committedAtMs'].every((key) => timestamp(value[key])) &&
    typeof value.provisional === 'boolean'
  )
}
export function validWatcher(value) {
  return (
    object(value) &&
    [
      'idle_no_viewers',
      'starting',
      'watching',
      'paused_interest_expired',
      'paused_recent_load_expired',
      'paused_control_unavailable',
    ].includes(value.state) &&
    integer(value.statusVersion) &&
    integer(value.runGeneration) &&
    timestamp(value.loadDeadlineMs) &&
    (value.pausedAtMs === null || timestamp(value.pausedAtMs)) &&
    (value.pauseReason === null || typeof value.pauseReason === 'string')
  )
}
export function validBaseline(value) {
  return (
    object(value) &&
    typeof value.baselineId === 'string' &&
    value.baselineId.length > 0 &&
    typeof value.datasetGeneration === 'string' &&
    value.datasetGeneration.length > 0 &&
    integer(value.epoch) &&
    integer(value.sequence) &&
    coverage(value.coverage) &&
    cumulative(value.cumulative)
  )
}
export function validSnapshot(value, poolId) {
  if (value?.poolId !== poolId) return false
  try {
    validateSnapshot(value)
    return true
  } catch {
    return false
  }
}
