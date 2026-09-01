import { type Address } from 'viem'
import { clientFor } from './clients'
import { erc20Abi } from './abis'
import { type VariableVault } from './vaults'

// The fixed side deploys into a Uniswap V3 position; its price band is [poolMinTick, poolMaxTick] on
// the adapter's pool. We read the band, the pair + fee tier (poolKey), and the pool's current tick
// (slot0), then convert ticks to a human price (token1 per token0, decimal-adjusted).
export interface FixedRange {
  pair: string
  token0: Address
  token1: Address
  pool: Address
  feePct: number
  tickLower: number
  tickUpper: number
  priceLower: number
  priceUpper: number
  priceCurrent: number
  inRange: boolean
  quote: string // e.g. "ARB per WETH"
}

const adapterAbi = [
  { name: 'pool', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }] },
  { name: 'poolMinTick', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
  { name: 'poolMaxTick', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'int24' }] },
  { name: 'poolKey', type: 'function', stateMutability: 'view', inputs: [], outputs: [{ type: 'address' }, { type: 'address' }, { type: 'uint24' }] },
] as const

const poolAbi = [
  {
    name: 'slot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }],
  },
] as const

type Mc<T> = { status: 'success'; result: T } | { status: 'failure' }
const ok = <T>(r: Mc<T> | undefined): T | undefined => (r && r.status === 'success' ? r.result : undefined)

const priceAt = (tick: number, dec0: number, dec1: number) => 1.0001 ** tick * 10 ** (dec0 - dec1)

// Positions (0..100%) for the range slider: the green band [lower..upper] and the white current-price
// marker, on an axis padded to comfortably contain all three.
export function rangeGeometry(r: FixedRange): { bandLeft: number; bandWidth: number; markerLeft: number } {
  const lo = r.priceLower
  const hi = r.priceUpper
  const cur = Number.isFinite(r.priceCurrent) ? r.priceCurrent : (lo + hi) / 2
  const min = Math.min(lo, cur)
  const max = Math.max(hi, cur)
  const pad = (max - min) * 0.18 || Math.abs(max) * 0.1 || 1
  const axisMin = min - pad
  const span = max + pad - axisMin || 1
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - axisMin) / span) * 100))
  return { bandLeft: pct(lo), bandWidth: Math.max(3, pct(hi) - pct(lo)), markerLeft: pct(cur) }
}

// Load fixed-side ranges for the given vaults (any mix of chains). Returns a map keyed by vault
// address (lowercased). Best-effort: a vault whose adapter/pool can't be read is simply omitted.
export async function loadFixedRanges(vaults: VariableVault[]): Promise<Map<string, FixedRange>> {
  const out = new Map<string, FixedRange>()
  const byChain = new Map<string, VariableVault[]>()
  for (const v of vaults) {
    const arr = byChain.get(v.chainKey) ?? []
    arr.push(v)
    byChain.set(v.chainKey, arr)
  }

  await Promise.all(
    [...byChain.entries()].map(async ([chainKey, vs]) => {
      const client = clientFor(chainKey as VariableVault['chainKey'])
      if (!client) return

      // Stage A: adapter pool / ticks / poolKey for each vault.
      const aRes = (await client.multicall({
        contracts: vs.flatMap((v) => [
          { address: v.adapter, abi: adapterAbi, functionName: 'pool' },
          { address: v.adapter, abi: adapterAbi, functionName: 'poolMinTick' },
          { address: v.adapter, abi: adapterAbi, functionName: 'poolMaxTick' },
          { address: v.adapter, abi: adapterAbi, functionName: 'poolKey' },
        ]),
        allowFailure: true,
      })) as Mc<unknown>[]

      const meta = vs.map((v, i) => {
        const b = i * 4
        return {
          v,
          pool: ok(aRes[b + 0] as Mc<Address>),
          minTick: ok(aRes[b + 1] as Mc<number>),
          maxTick: ok(aRes[b + 2] as Mc<number>),
          key: ok(aRes[b + 3] as Mc<readonly [Address, Address, number]>),
        }
      })

      // Collect distinct tokens + pools for stage B.
      const tokens = new Set<Address>()
      const pools = new Set<Address>()
      for (const m of meta) {
        if (m.key) {
          tokens.add(m.key[0])
          tokens.add(m.key[1])
        }
        if (m.pool) pools.add(m.pool)
      }
      const tokenList = [...tokens]
      const poolList = [...pools]

      // Stage B: token symbol+decimals and each pool's current tick.
      const bRes = (await client.multicall({
        contracts: [
          ...tokenList.flatMap((t) => [
            { address: t, abi: erc20Abi, functionName: 'symbol' },
            { address: t, abi: erc20Abi, functionName: 'decimals' },
          ]),
          ...poolList.map((p) => ({ address: p, abi: poolAbi, functionName: 'slot0' })),
        ],
        allowFailure: true,
      })) as Mc<unknown>[]

      const tokenInfo = new Map<string, { symbol: string; decimals: number }>()
      tokenList.forEach((t, i) => {
        tokenInfo.set(t.toLowerCase(), {
          symbol: (ok(bRes[i * 2] as Mc<string>) as string) ?? '?',
          decimals: Number(ok(bRes[i * 2 + 1] as Mc<number>) ?? 18),
        })
      })
      const poolTick = new Map<string, number>()
      poolList.forEach((p, i) => {
        const s = ok(bRes[tokenList.length * 2 + i] as Mc<readonly unknown[]>)
        if (s) poolTick.set(p.toLowerCase(), Number((s as readonly unknown[])[1]))
      })

      for (const m of meta) {
        if (!m.key || m.minTick === undefined || m.maxTick === undefined || !m.pool) continue
        const t0 = tokenInfo.get(m.key[0].toLowerCase())
        const t1 = tokenInfo.get(m.key[1].toLowerCase())
        if (!t0 || !t1) continue
        const cur = poolTick.get(m.pool.toLowerCase())
        const pLower = priceAt(Number(m.minTick), t0.decimals, t1.decimals)
        const pUpper = priceAt(Number(m.maxTick), t0.decimals, t1.decimals)
        const pCur = cur !== undefined ? priceAt(cur, t0.decimals, t1.decimals) : NaN
        out.set(m.v.vault.toLowerCase(), {
          pair: `${t0.symbol}/${t1.symbol}`,
          token0: m.key[0],
          token1: m.key[1],
          pool: m.pool,
          feePct: Number(m.key[2]) / 10_000,
          tickLower: Number(m.minTick),
          tickUpper: Number(m.maxTick),
          priceLower: pLower,
          priceUpper: pUpper,
          priceCurrent: pCur,
          inRange: !Number.isNaN(pCur) && pCur >= pLower && pCur <= pUpper,
          quote: `${t1.symbol} per ${t0.symbol}`,
        })
      }
    }),
  )

  return out
}
