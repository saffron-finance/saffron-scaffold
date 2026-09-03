/**
 * Immutable terms for the first fixed-yield amount-matching flow.
 *
 * These are copied from the reviewed `feat/fixed-side-intents` implementation.
 * The variable-yield provider has already selected the pair, term, range, and
 * premium pool, so a fixed-yield depositor chooses only a source asset and a
 * maximum amount.
 */
export const FIXED_INTENT_TERMS = {
  pair: 'CASHCAT / WETH',
  network: 'Robinhood Chain',
  feeTierLabel: '1%',
  minTick: -101_000,
  maxTick: -87_000,
  aprBps: 100_000n,
  durationSeconds: 3n * 24n * 60n * 60n,
  availableVariableYieldMicros: 1_000n * 1_000_000n,
  // The static preview uses the same clearly labelled reference price as the
  // original hosted review. An executable LI.FI quote is obtained only after
  // an exact vault exists.
  ethReferencePriceMicros: 4_000n * 1_000_000n,
} as const

export type FundingCurrency = 'USDG' | 'ETH'

const USD_MICROS_PER_DOLLAR = 1_000_000n
const USD_MICROS_PER_CENT = 10_000n
const BPS_DENOMINATOR = 10_000n
const SECONDS_PER_YEAR = 365n * 24n * 60n * 60n

/** Divide and round upward so a displayed match never underfunds its premium. */
function divideRoundUp(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error('Denominator must be positive')
  return (numerator + denominator - 1n) / denominator
}

/**
 * Parse a positive decimal amount into base units without floating-point math.
 * Commas are accepted; negatives, malformed values, and excess precision fail.
 */
export function parseUnsignedUnits(value: string, decimals: number): bigint | undefined {
  const normalized = value.replace(/,/g, '').trim()
  if (!/^\d*(?:\.\d*)?$/.test(normalized) || !/[0-9]/.test(normalized)) return undefined

  const [whole = '0', fraction = ''] = normalized.split('.')
  if (fraction.length > decimals) return undefined

  const paddedFraction = fraction.padEnd(decimals, '0')
  const parsed = BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(paddedFraction || '0')
  return parsed > 0n ? parsed : undefined
}

/** Convert a USDG or ETH source budget into six-decimal indicative USD units. */
export function fundingAmountToUsdMicros(amount: bigint, currency: FundingCurrency): bigint {
  if (currency === 'USDG') return amount
  return (amount * FIXED_INTENT_TERMS.ethReferencePriceMicros) / 10n ** 18n
}

/** Calculate the USDG premium: fixed principal × APR × term / one year. */
export function requiredVariableYieldMicros(fixedUsdMicros: bigint): bigint {
  if (fixedUsdMicros <= 0n) return 0n
  return divideRoundUp(
    fixedUsdMicros * FIXED_INTENT_TERMS.aprBps * FIXED_INTENT_TERMS.durationSeconds,
    BPS_DENOMINATOR * SECONDS_PER_YEAR,
  )
}

/** Maximum fixed principal supported by the available variable-yield premium. */
export function maximumFixedCapacityMicros(): bigint {
  return (
    (FIXED_INTENT_TERMS.availableVariableYieldMicros * BPS_DENOMINATOR * SECONDS_PER_YEAR) /
    (FIXED_INTENT_TERMS.aprBps * FIXED_INTENT_TERMS.durationSeconds)
  )
}

export interface FixedIntentPreview {
  fixedUsdMicros: bigint
  requiredVariableYieldMicros: bigint
  remainingVariableYieldMicros: bigint
  matched: boolean
}

/** Canonicalize to cents, then evaluate the request against available yield. */
export function previewFixedIntent(requestedUsdMicros: bigint): FixedIntentPreview {
  const fixedUsdMicros = (requestedUsdMicros / USD_MICROS_PER_CENT) * USD_MICROS_PER_CENT
  const required = requiredVariableYieldMicros(fixedUsdMicros)
  const matched = fixedUsdMicros > 0n && required <= FIXED_INTENT_TERMS.availableVariableYieldMicros

  return {
    fixedUsdMicros,
    requiredVariableYieldMicros: required,
    remainingVariableYieldMicros: matched
      ? FIXED_INTENT_TERMS.availableVariableYieldMicros - required
      : 0n,
    matched,
  }
}

/** Format six-decimal USD/USDG values without exposing binary-float residue. */
export function formatMicros(value: bigint, maximumFractionDigits = 6): string {
  const whole = value / USD_MICROS_PER_DOLLAR
  const fraction = (value % USD_MICROS_PER_DOLLAR).toString().padStart(6, '0')
  const trimmed = fraction.slice(0, maximumFractionDigits).replace(/0+$/, '')
  const wholeLabel = Number(whole).toLocaleString('en-US')
  return trimmed ? `${wholeLabel}.${trimmed}` : wholeLabel
}
