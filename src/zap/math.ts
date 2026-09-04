import { sqrtRatioAtTick } from '../fixedVaults/model'

import { TICK_BAND_SAME_CHAIN } from './config'

const MIN_TICK = -887272
const MAX_TICK = 887272
const Q96 = 1n << 96n

export interface ZapSizingParams {
  liquidity: bigint
  tickLower: number
  tickUpper: number
  tickCurrent: number
  tickBand: number
}

export interface ZapAmounts {
  amount0: bigint
  amount1: bigint
}

function amount0Delta(a: bigint, b: bigint, liquidity: bigint): bigint {
  const [lower, upper] = a > b ? [b, a] : [a, b]
  return (((liquidity << 96n) * (upper - lower)) / upper) / lower
}

function amount1Delta(a: bigint, b: bigint, liquidity: bigint): bigint {
  const [lower, upper] = a > b ? [b, a] : [a, b]
  return (liquidity * (upper - lower)) / Q96
}

/** Convert one liquidity value to raw token amounts at an exact sqrt price. */
export function amountsForLiquidityAtSqrtPrice({
  liquidity,
  tickLower,
  tickUpper,
  sqrtPriceX96,
}: Omit<ZapSizingParams, 'tickCurrent' | 'tickBand'> & { sqrtPriceX96: bigint }): ZapAmounts {
  const lower = sqrtRatioAtTick(tickLower)
  const upper = sqrtRatioAtTick(tickUpper)
  return {
    amount0:
      sqrtPriceX96 < lower
        ? amount0Delta(lower, upper, liquidity)
        : sqrtPriceX96 < upper
          ? amount0Delta(sqrtPriceX96, upper, liquidity)
          : 0n,
    amount1:
      sqrtPriceX96 < lower
        ? 0n
        : sqrtPriceX96 < upper
          ? amount1Delta(lower, sqrtPriceX96, liquidity)
          : amount1Delta(lower, upper, liquidity),
  }
}

/** Convert liquidity to token amounts at the integer tick used for zap sizing. */
export function amountsForLiquidityAtTick(
  params: Omit<ZapSizingParams, 'tickBand'>,
): ZapAmounts {
  return amountsForLiquidityAtSqrtPrice({
    liquidity: params.liquidity,
    tickLower: params.tickLower,
    tickUpper: params.tickUpper,
    sqrtPriceX96: sqrtRatioAtTick(params.tickCurrent),
  })
}

/**
 * Size each token independently at the adverse edge of a same-chain tick band.
 * A percent buffer fails near a range edge because a percentage of zero is
 * still zero; absolute worst-case amounts keep the executor solvent instead.
 */
export function getWorstCaseAmountsForTickBand(params: ZapSizingParams): ZapAmounts {
  if (params.tickBand < 0) throw new Error('tickBand must be >= 0')
  const lowTick = Math.max(MIN_TICK, params.tickCurrent - params.tickBand)
  const highTick = Math.min(MAX_TICK, params.tickCurrent + params.tickBand)
  const low = amountsForLiquidityAtTick({ ...params, tickCurrent: lowTick })
  const high = amountsForLiquidityAtTick({ ...params, tickCurrent: highTick })
  return {
    amount0: low.amount0 > high.amount0 ? low.amount0 : high.amount0,
    amount1: low.amount1 > high.amount1 ? low.amount1 : high.amount1,
  }
}

function overheadBps(worst: bigint, current: bigint): number | null {
  if (current === 0n) return worst === 0n ? 0 : null
  return Number(((worst - current) * 10_000n) / current)
}

/** Worst-case amounts plus the capital overhead visible to the caller. */
export function getZapSizing(params: ZapSizingParams) {
  const worst = getWorstCaseAmountsForTickBand(params)
  const current = amountsForLiquidityAtTick(params)
  return {
    ...worst,
    current,
    overheadBps0: overheadBps(worst.amount0, current.amount0),
    overheadBps1: overheadBps(worst.amount1, current.amount1),
  }
}

/** Refuse edge cases whose required fronting exceeds the reviewed 25% ceiling. */
export function getZapViability(
  params: ZapSizingParams,
  { maxOverheadBps = 2_500 }: { maxOverheadBps?: number } = {},
) {
  const { overheadBps0, overheadBps1 } = getZapSizing(params)
  const unbounded = overheadBps0 === null || overheadBps1 === null
  if (unbounded) return { viable: false, unbounded, worstOverheadBps: null }
  const worstOverheadBps = Math.max(overheadBps0, overheadBps1)
  return {
    viable: worstOverheadBps <= maxOverheadBps,
    unbounded,
    worstOverheadBps,
  }
}

/** Integer square root, rounded down, used to perturb a Q96 price precisely. */
function integerSqrt(value: bigint): bigint {
  if (value < 0n) throw new Error('Cannot take the square root of a negative value')
  if (value < 2n) return value
  let x = 1n << (BigInt(value.toString(2).length) + 1n >> 1n)
  for (;;) {
    const next = (x + value / x) >> 1n
    if (next >= x) return x
    x = next
  }
}

/**
 * Build the adapter's amount floors at the post-swap price. Price perturbation
 * protects the LP ratio while the additional haircut handles rounding and the
 * single-sided boundary case documented by the source implementation.
 */
export function getMinAmountsWithSlippage({
  liquidity,
  tickLower,
  tickUpper,
  sqrtPriceX96,
  slippageBps,
}: {
  liquidity: bigint
  tickLower: number
  tickUpper: number
  sqrtPriceX96: bigint
  slippageBps: number
}): { amount0Min: bigint; amount1Min: bigint } {
  const bps = Math.round(slippageBps)
  if (bps <= 0 || bps >= 10_000) throw new Error('Invalid slippage tolerance')
  const squaredPrice = sqrtPriceX96 * sqrtPriceX96
  const sqrtLower = integerSqrt((squaredPrice * BigInt(10_000 - bps)) / 10_000n)
  const sqrtUpper = integerSqrt((squaredPrice * BigInt(10_000 + bps)) / 10_000n)
  const desired = amountsForLiquidityAtSqrtPrice({
    liquidity,
    tickLower,
    tickUpper,
    sqrtPriceX96,
  })
  const upperPriceAmounts = amountsForLiquidityAtSqrtPrice({
    liquidity,
    tickLower,
    tickUpper,
    sqrtPriceX96: sqrtUpper,
  })
  const lowerPriceAmounts = amountsForLiquidityAtSqrtPrice({
    liquidity,
    tickLower,
    tickUpper,
    sqrtPriceX96: sqrtLower,
  })
  const haircut = (amount: bigint) => (amount * BigInt(10_000 - bps)) / 10_000n
  const haircut0 = haircut(desired.amount0)
  const haircut1 = haircut(desired.amount1)
  return {
    amount0Min:
      upperPriceAmounts.amount0 < haircut0 ? upperPriceAmounts.amount0 : haircut0,
    amount1Min:
      lowerPriceAmounts.amount1 < haircut1 ? lowerPriceAmounts.amount1 : haircut1,
  }
}

/**
 * Invert TickMath without floating point. The greatest tick whose sqrt ratio
 * does not exceed the input is found in at most 21 iterations.
 */
export function sqrtPriceX96ToTick(sqrtPriceX96: bigint): number {
  if (sqrtPriceX96 < sqrtRatioAtTick(MIN_TICK) || sqrtPriceX96 >= sqrtRatioAtTick(MAX_TICK)) {
    throw new Error('Invalid Uniswap sqrt price')
  }
  let low = MIN_TICK
  let high = MAX_TICK
  while (low < high) {
    const middle = Math.floor((low + high + 1) / 2)
    if (sqrtRatioAtTick(middle) <= sqrtPriceX96) low = middle
    else high = middle - 1
  }
  return low
}

export { TICK_BAND_SAME_CHAIN }
