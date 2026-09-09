// SPDX-License-Identifier: GPL-2.0-or-later
// TickMath constants/algorithm adapted from Uniswap v3-core (GPL-2.0-or-later):
// https://github.com/Uniswap/v3-core/blob/v1.0.0/contracts/libraries/TickMath.sol
// Integer arithmetic follows Uniswap v3 TickMath/SqrtPriceMath and the protocol
// adapter. No floating-point approximation may become transaction calldata.
const Q96 = 1n << 96n
const Q128 = 1n << 128n
const MAX256 = (1n << 256n) - 1n
const factors = [
  0xfffcb933bd6fad37aa2d162d1a594001n,0xfff97272373d413259a46990580e213an,
  0xfff2e50f5f656932ef12357cf3c7fdccn,0xffe5caca7e10e4e61c3624eaa0941cd0n,
  0xffcb9843d60f6159c9db58835c926644n,0xff973b41fa98c081472e6896dfb254c0n,
  0xff2ea16466c96a3843ec78b326b52861n,0xfe5dee046a99a2a811c461f1969c3053n,
  0xfcbe86c7900a88aedcffc83b479aa3a4n,0xf987a7253ac413176f2b074cf7815e54n,
  0xf3392b0822b70005940c7a398e4b70f3n,0xe7159475a2c29b7443b29c7fa6e889d9n,
  0xd097f3bdfd2022b8845ad8f792aa5825n,0xa9f746462d870fdf8a65dc1f90e061e5n,
  0x70d869a156d2a1b890bb3df62baf32f7n,0x31be135f97d08fd981231505542fcfa6n,
  0x9aa508b5b7a84e1c677de54f3e99bc9n,0x5d6af8dedb81196699c329225ee604n,
  0x2216e584f5fa1ea926041bedfe98n,0x48a170391f7dc42444e8fa2n,
]
export const ceilDiv = (a, b) => (a + b - 1n) / b

/** Exact TickMath ratio, rounded up from Q128.128 to Q64.96. */
export function sqrtAtTick(tick) {
  if (!Number.isInteger(tick) || Math.abs(tick) > 887272) throw new Error('Invalid tick')
  const absolute = Math.abs(tick)
  let ratio = Q128
  for (let i = 0; i < factors.length; i++) if (absolute & (1 << i)) ratio = ratio * factors[i] >> 128n
  if (tick > 0) ratio = MAX256 / ratio
  return ceilDiv(ratio, 1n << 32n)
}

/** Protocol LiquidityAmounts floors token amounts in base units needed by the adapter for exactly this liquidity. */
export function amountsForLiquidity(liquidity, sqrtPrice, minTick, maxTick) {
  const low = sqrtAtTick(minTick), high = sqrtAtTick(maxTick)
  const price = BigInt(sqrtPrice), amount = BigInt(liquidity)
  if (low >= high || price <= 0n || amount <= 0n || amount >= (1n << 128n)) throw new Error('Invalid liquidity')
  const p = price < low ? low : price > high ? high : price
  return {
    amount0: amount * (high - p) * Q96 / (high * p),
    amount1: amount * (p - low) / Q96,
  }
}

/** Resolve USD cents/APR to immutable liquidity and premium using fresh USD prices (1e18). */
export function resolveCapacities({ cents, aprRaw, duration, price0, price1, variablePrice,
  decimals0, decimals1, variableDecimals, sqrtPrice, minTick, maxTick }) {
  const usd = BigInt(cents) * 10n ** 16n
  if ([usd, BigInt(price0), BigInt(price1), BigInt(variablePrice), BigInt(aprRaw)].some(v => v <= 0n)) throw new Error('Invalid sizing prices')
  const probe = amountsForLiquidity(Q96, sqrtPrice, minTick, maxTick)
  const value = probe.amount0 * BigInt(price0) / 10n ** BigInt(decimals0) + probe.amount1 * BigInt(price1) / 10n ** BigInt(decimals1)
  if (value <= 0n) throw new Error('Unresolvable liquidity value')
  const liquidity = usd * Q96 / value
  const premium = ceilDiv(usd * BigInt(aprRaw) * BigInt(duration) * 10n ** BigInt(variableDecimals),
    10n ** 18n * 31_536_000n * BigInt(variablePrice))
  amountsForLiquidity(liquidity, sqrtPrice, minTick, maxTick)
  if (premium <= 0n || premium > MAX256) throw new Error('Invalid premium')
  return { liquidity: liquidity.toString(), premium: premium.toString() }
}
