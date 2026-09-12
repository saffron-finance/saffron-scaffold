export function ceilDiv(a: bigint, b: bigint): bigint
export function sqrtAtTick(tick: number): bigint
export function amountsForLiquidity(liquidity: bigint | string, sqrtPrice: bigint | string, minTick: number, maxTick: number): { amount0: bigint; amount1: bigint }
export function resolveCapacities(input: any): { liquidity: string; premium: string }
