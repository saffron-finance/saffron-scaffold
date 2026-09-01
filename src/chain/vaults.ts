import { type PublicClient, type Address } from 'viem'
import { factoryAbi, vaultAbi, erc20Abi } from './abis'
import { clientFor } from './clients'
import { CHAINS, type ChainDef, type ChainKey } from './chains'

export interface VariableVault {
  chainKey: ChainKey
  chainLabel: string
  explorer: string
  vaultId: number
  factory: `0x${string}`
  vault: `0x${string}`
  adapter: `0x${string}`
  // Variable-side view
  variableAsset: `0x${string}`
  variableBearer: `0x${string}` // bearer token; balanceOf(user) = a depositor's current position
  claimToken: `0x${string}` // supply is exactly 1 while a funding-stage fixed UniV3 deposit is present
  variableAssetSymbol: string
  variableAssetDecimals: number
  variableSideCapacity: bigint // target, in variableAsset units
  variableDeposited: bigint // current, from the bearer token total supply (1 bearer per unit deposited)
  variableRemaining: bigint // capacity - deposited (room still open to variable depositors)
  fillRatio: number // 0..1 (deposited / capacity)
  fixedSideCapacity: bigint // target fixed-side liquidity recorded by the vault
  fixedDepositPresent: boolean | null // null means the authoritative claim-token read failed
  // Lifecycle
  isStarted: boolean
  earningsSettled: boolean
  endTime: number // unix seconds (0 until started)
  durationSecs: number
  feeBps: number
}

// The ten vault getters we batch per vault, in a fixed order we index into below.
const VAULT_GETTERS = [
  'variableAsset',
  'variableBearerToken',
  'claimToken',
  'variableSideCapacity',
  'fixedSideCapacity',
  'isStarted',
  'earningsSettled',
  'endTime',
  'duration',
  'feeBps',
] as const

type Mc<T> = { status: 'success'; result: T } | { status: 'failure'; error: Error }

function ok<T>(r: Mc<T> | undefined, fallback: T): T {
  return r && r.status === 'success' ? r.result : fallback
}

// Enumerate every vault on one factory and read its variable-side state, using Multicall3 to collapse
// what would be ~10 sequential reads per vault into three batched calls (viem auto-chunks each batch).
async function loadFactory(client: PublicClient, def: ChainDef, factory: `0x${string}`): Promise<VariableVault[]> {
  const next = (await client.readContract({ address: factory, abi: factoryAbi, functionName: 'nextVaultId' })) as bigint
  const count = Number(next) - 1 // ids run 1..next-1
  if (count <= 0) return []
  const ids = Array.from({ length: count }, (_, i) => i + 1)

  // 1) vaultInfo(id) for every id → vault + adapter addresses.
  const infos = (await client.multicall({
    contracts: ids.map((id) => ({ address: factory, abi: factoryAbi, functionName: 'vaultInfo', args: [BigInt(id)] })),
    allowFailure: true,
  })) as Mc<readonly [Address, Address, Address, bigint]>[]

  const rows = ids
    .map((id, i) => {
      const info = infos[i]
      if (info?.status !== 'success') return null
      return { id, vault: info.result[1], adapter: info.result[2] }
    })
    .filter((r): r is { id: number; vault: Address; adapter: Address } => r !== null)
  if (rows.length === 0) {
    // count > 0 but every vaultInfo read failed — a real failure, not an empty factory. Surface it.
    const firstErr = infos.find((r) => r.status === 'failure') as { error?: Error } | undefined
    throw new Error(`all ${count} vaultInfo reads failed${firstErr?.error ? ` (${firstErr.error.message})` : ''}`)
  }

  // 2) The ten getters for every vault, one flat batch.
  const vaultResults = (await client.multicall({
    contracts: rows.flatMap((r) => VAULT_GETTERS.map((fn) => ({ address: r.vault, abi: vaultAbi, functionName: fn }))),
    allowFailure: true,
  })) as Mc<unknown>[]

  const G = VAULT_GETTERS.length
  const partial = rows.map((r, i) => {
    const b = i * G
    return {
      ...r,
      variableAsset: ok(vaultResults[b + 0] as Mc<Address>, '0x0000000000000000000000000000000000000000'),
      variableBearer: ok(vaultResults[b + 1] as Mc<Address>, '0x0000000000000000000000000000000000000000'),
      claimToken: ok(vaultResults[b + 2] as Mc<Address>, '0x0000000000000000000000000000000000000000'),
      variableSideCapacity: ok(vaultResults[b + 3] as Mc<bigint>, 0n),
      fixedSideCapacity: ok(vaultResults[b + 4] as Mc<bigint>, 0n),
      isStarted: ok(vaultResults[b + 5] as Mc<boolean>, false),
      earningsSettled: ok(vaultResults[b + 6] as Mc<boolean>, false),
      endTime: ok(vaultResults[b + 7] as Mc<bigint>, 0n),
      duration: ok(vaultResults[b + 8] as Mc<bigint>, 0n),
      feeBps: ok(vaultResults[b + 9] as Mc<bigint>, 0n),
    }
  })

  // 3) ERC20 metadata plus variable-bearer and fixed claim-token supplies.
  // UniV3Vault mints exactly one claim token when the fixed position is
  // deposited, and burns it again on a pre-start fixed withdrawal.
  const erc20Results = (await client.multicall({
    contracts: partial.flatMap((p) => [
      { address: p.variableAsset, abi: erc20Abi, functionName: 'symbol' },
      { address: p.variableAsset, abi: erc20Abi, functionName: 'decimals' },
      { address: p.variableBearer, abi: erc20Abi, functionName: 'totalSupply' },
      { address: p.claimToken, abi: erc20Abi, functionName: 'totalSupply' },
    ]),
    allowFailure: true,
  })) as Mc<unknown>[]

  return partial.map((p, i) => {
    const e = i * 4
    const symbol = ok(erc20Results[e + 0] as Mc<string>, '?')
    const decimals = Number(ok(erc20Results[e + 1] as Mc<number>, 18))
    const variableDeposited = ok(erc20Results[e + 2] as Mc<bigint>, 0n)
    const claimSupplyResult = erc20Results[e + 3] as Mc<bigint> | undefined
    const claimTokenSupply = claimSupplyResult?.status === 'success' ? claimSupplyResult.result : null
    // A vault can only start after the fixed claim supply reached one. Preserve
    // that filled-capacity fact after claim() swaps the claim token for a fixed
    // bearer token; for a funding-stage modal, the live claim supply is exact.
    const fixedDepositPresent = p.isStarted ? true : claimTokenSupply === null ? null : claimTokenSupply > 0n
    const fillRatio =
      p.variableSideCapacity > 0n ? Number((variableDeposited * 10000n) / p.variableSideCapacity) / 10000 : 0
    return {
      chainKey: def.key,
      chainLabel: def.label,
      explorer: def.explorer,
      vaultId: p.id,
      factory,
      vault: p.vault,
      adapter: p.adapter,
      variableAsset: p.variableAsset,
      variableBearer: p.variableBearer,
      claimToken: p.claimToken,
      variableAssetSymbol: symbol,
      variableAssetDecimals: decimals,
      variableSideCapacity: p.variableSideCapacity,
      variableDeposited,
      variableRemaining: p.variableSideCapacity > variableDeposited ? p.variableSideCapacity - variableDeposited : 0n,
      fillRatio,
      fixedSideCapacity: p.fixedSideCapacity,
      fixedDepositPresent,
      isStarted: p.isStarted,
      earningsSettled: p.earningsSettled,
      endTime: Number(p.endTime),
      durationSecs: Number(p.duration),
      feeBps: Number(p.feeBps),
    }
  })
}

export interface LoadResult {
  vaults: VariableVault[]
  errors: string[]
}

// Load variable-side data for every vault across every chain that has a usable RPC.
export async function loadAllVaults(): Promise<LoadResult> {
  const errors: string[] = []

  // Surface any configured chain that has no client (missing/blank RPC) instead of silently
  // dropping it — a chain showing 0 vaults should say why.
  for (const def of CHAINS) {
    if (!clientFor(def.key)) errors.push(`${def.label}: no usable RPC configured — chain skipped`)
  }

  const perChain = await Promise.all(
    CHAINS.map(async (def) => {
      const client = clientFor(def.key)
      if (!client) return [] as VariableVault[]
      const results: VariableVault[] = []
      for (const factory of def.factories) {
        try {
          results.push(...(await loadFactory(client, def, factory)))
        } catch (err) {
          errors.push(`${def.label} factory ${factory}: ${(err as Error)?.message ?? String(err)}`)
        }
      }
      return results
    }),
  )
  return { vaults: perChain.flat(), errors }
}
