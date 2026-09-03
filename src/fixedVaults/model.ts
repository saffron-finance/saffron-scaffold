import { formatUnits } from 'viem'
import { type ChainKey } from '../chain/chains'

/**
 * Normalized subset of the production Saffron vault-list response required by
 * the fixed-side selector and its compact deposit preview.
 */
export interface FixedVault {
  chainKey: ChainKey
  chainId: number
  chainLabel: string
  explorer: string
  address: `0x${string}`
  adapterAddress: `0x${string}`
  durationSecs: number
  fixedSideCapacity: bigint
  claimTokenSupply: bigint
  variableDeposited: bigint
  variableAsset: FixedVaultToken
  token0: FixedVaultToken
  token1: FixedVaultToken
  pool: {
    address: `0x${string}`
    tick: number
    tickSpacing: number
    sqrtPriceX96: bigint
  }
  minTick: number
  maxTick: number
  apr: number
  fixedRate: number
  usdLiquidityValue: bigint
  isOutOfRange: boolean
}

export interface FixedVaultToken {
  address: `0x${string}`
  symbol: string
  decimals: number
  priceUsd: number
  /** Only the variable premium token carries a vault capacity. */
  capacity?: bigint
}

interface ChainMetadata {
  key: ChainKey
  label: string
  explorer: string
}

const CHAIN_METADATA: Record<number, ChainMetadata> = {
  1: { key: 'ethereum', label: 'Ethereum', explorer: 'https://etherscan.io' },
  42161: { key: 'arbitrum', label: 'Arbitrum', explorer: 'https://arbiscan.io' },
  4663: {
    key: 'robinhood',
    label: 'Robinhood Chain',
    explorer: 'https://robinhoodchain.blockscout.com',
  },
}

type ApiObject = Record<string, any>

/**
 * Convert one official API vault-details object into the deliberately small
 * shape this standalone selector consumes. Invalid/incomplete records are
 * dropped instead of producing rows that cannot open a trustworthy modal.
 */
export function normalizeFixedVault(value: ApiObject): FixedVault | null {
  try {
    const vault = value.vault as ApiObject
    const info = value.vaultInfo as ApiObject
    const adapter = value.adapter as ApiObject
    const pool = adapter.pool as ApiObject
    const variableAsset = value.vaultTokens.variableAsset as ApiObject
    const token0 = value.adapterTokens.token0 as ApiObject
    const token1 = value.adapterTokens.token1 as ApiObject
    const chainId = Number(vault.chainId)
    const chain = CHAIN_METADATA[chainId]
    if (!chain || !vault.address || !info.adapterAddress || !pool.address) return null

    return {
      chainKey: chain.key,
      chainId,
      chainLabel: chain.label,
      explorer: chain.explorer,
      address: vault.address as `0x${string}`,
      adapterAddress: info.adapterAddress as `0x${string}`,
      durationSecs: Number(vault.duration),
      fixedSideCapacity: BigInt(vault.fixedSideCapacity),
      claimTokenSupply: BigInt(vault.claimTokenSupply),
      variableDeposited: BigInt(vault.variableBearerTokenSupply ?? 0),
      variableAsset: normalizeToken(variableAsset, value.tokenPrices?.priceVariableAssetUsd, vault.variableSideCapacity),
      token0: normalizeToken(token0, value.tokenPrices?.priceToken0Usd),
      token1: normalizeToken(token1, value.tokenPrices?.priceToken1Usd),
      pool: {
        address: pool.address as `0x${string}`,
        tick: Number(pool.tick),
        tickSpacing: Number(pool.tickSpacing),
        sqrtPriceX96: BigInt(pool.sqrtPriceX96),
      },
      minTick: Number(adapter.minTick),
      maxTick: Number(adapter.maxTick),
      apr: Number(value.rates?.fixed?.apr ?? 0),
      fixedRate: Number(value.rates?.fixed?.fixedRate ?? 0),
      usdLiquidityValue: BigInt(value.rates?.usdLiquidityValue ?? 0),
      isOutOfRange: Boolean(value.isOutOfRange),
    }
  } catch {
    return null
  }
}

function normalizeToken(token: ApiObject, priceUsd: unknown, capacity?: unknown): FixedVaultToken {
  return {
    address: token.address as `0x${string}`,
    symbol: String(token.symbol || '?'),
    decimals: Number(token.decimals ?? 18),
    priceUsd: Number(priceUsd ?? 0),
    ...(capacity == null ? {} : { capacity: BigInt(capacity as string) }),
  }
}

/** Fixed-side availability follows the production fixed vault list. */
export function fixedDepositable(vault: FixedVault): boolean {
  return vault.claimTokenSupply === 0n && vault.fixedSideCapacity > 0n
}

export function fixedPair(vault: FixedVault): string {
  return `${vault.token0.symbol}/${vault.token1.symbol}`
}

export function fixedPremiumUsd(vault: FixedVault): number {
  if (vault.variableAsset.capacity == null) return 0
  return Number(formatUnits(vault.variableAsset.capacity, vault.variableAsset.decimals)) * vault.variableAsset.priceUsd
}

export function fixedPremiumLabel(vault: FixedVault): string {
  const capacity = vault.variableAsset.capacity ?? 0n
  return `${formatTokenAmount(capacity, vault.variableAsset.decimals)} ${vault.variableAsset.symbol}`
}

export function fixedCapacityUsd(vault: FixedVault): number {
  // The official API stores USD liquidity values with six decimal places.
  return Number(formatUnits(vault.usdLiquidityValue, 6))
}

export function formatUsd(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: value < 100 ? 2 : 0,
  })
}

/** Table summaries use whole-dollar values so every row has one compact number. */
export function formatUsdWhole(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  })
}

export function formatPercent(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${(value * 100).toLocaleString('en-US', { maximumFractionDigits: 2 })}%`
}

export function formatTokenAmount(value: bigint, decimals: number): string {
  const n = Number(formatUnits(value, decimals))
  if (!Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', {
    maximumFractionDigits: n < 0.01 ? 6 : n < 1 ? 4 : 2,
  })
}

const Q96 = 1n << 96n
const MAX_UINT256 = (1n << 256n) - 1n

/** Exact native-BigInt port of Uniswap V3 TickMath.getSqrtRatioAtTick. */
export function sqrtRatioAtTick(tick: number): bigint {
  if (!Number.isInteger(tick) || tick < -887272 || tick > 887272) throw new Error('Invalid Uniswap tick')
  const absTick = Math.abs(tick)
  let ratio =
    (absTick & 0x1) !== 0
      ? 0xfffcb933bd6fad37aa2d162d1a594001n
      : 0x100000000000000000000000000000000n
  const factors: Array<[number, bigint]> = [
    [0x2, 0xfff97272373d413259a46990580e213an],
    [0x4, 0xfff2e50f5f656932ef12357cf3c7fdccn],
    [0x8, 0xffe5caca7e10e4e61c3624eaa0941cd0n],
    [0x10, 0xffcb9843d60f6159c9db58835c926644n],
    [0x20, 0xff973b41fa98c081472e6896dfb254c0n],
    [0x40, 0xff2ea16466c96a3843ec78b326b52861n],
    [0x80, 0xfe5dee046a99a2a811c461f1969c3053n],
    [0x100, 0xfcbe86c7900a88aedcffc83b479aa3a4n],
    [0x200, 0xf987a7253ac413176f2b074cf7815e54n],
    [0x400, 0xf3392b0822b70005940c7a398e4b70f3n],
    [0x800, 0xe7159475a2c29b7443b29c7fa6e889d9n],
    [0x1000, 0xd097f3bdfd2022b8845ad8f792aa5825n],
    [0x2000, 0xa9f746462d870fdf8a65dc1f90e061e5n],
    [0x4000, 0x70d869a156d2a1b890bb3df62baf32f7n],
    [0x8000, 0x31be135f97d08fd981231505542fcfa6n],
    [0x10000, 0x9aa508b5b7a84e1c677de54f3e99bc9n],
    [0x20000, 0x5d6af8dedb81196699c329225ee604n],
    [0x40000, 0x2216e584f5fa1ea926041bedfe98n],
    [0x80000, 0x48a170391f7dc42444e8fa2n],
  ]
  for (const [bit, factor] of factors) if ((absTick & bit) !== 0) ratio = (ratio * factor) >> 128n
  if (tick > 0) ratio = MAX_UINT256 / ratio
  const remainder = ratio & ((1n << 32n) - 1n)
  return (ratio >> 32n) + (remainder === 0n ? 0n : 1n)
}

function amount0Delta(a: bigint, b: bigint, liquidity: bigint): bigint {
  const [lower, upper] = a > b ? [b, a] : [a, b]
  return (((liquidity << 96n) * (upper - lower)) / upper) / lower
}

function amount1Delta(a: bigint, b: bigint, liquidity: bigint): bigint {
  const [lower, upper] = a > b ? [b, a] : [a, b]
  return (liquidity * (upper - lower)) / Q96
}

/** Required raw token amounts for the vault's target liquidity at the cached pool price. */
export function requiredFixedAmounts(vault: FixedVault): { amount0: bigint; amount1: bigint } {
  const lower = sqrtRatioAtTick(vault.minTick)
  const upper = sqrtRatioAtTick(vault.maxTick)
  const current = vault.pool.sqrtPriceX96
  const amount0 = current < lower
    ? amount0Delta(lower, upper, vault.fixedSideCapacity)
    : current < upper
      ? amount0Delta(current, upper, vault.fixedSideCapacity)
      : 0n
  const amount1 = current < lower
    ? 0n
    : current < upper
      ? amount1Delta(lower, current, vault.fixedSideCapacity)
      : amount1Delta(lower, upper, vault.fixedSideCapacity)
  return { amount0, amount1 }
}

export function fixedDepositUrl(vault: FixedVault): string {
  return `https://beta.saffron.finance/network/${vault.chainKey}/vault/${vault.address}/fixed`
}
