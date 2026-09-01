import rawSnapshot from './snapshot.json'
import { type FixedRange } from '../chain/fixedRange'
import { type VariableVault } from '../chain/vaults'

interface SerializedVault extends Omit<
  VariableVault,
  'variableSideCapacity' | 'variableDeposited' | 'variableRemaining' | 'fixedSideCapacity'
> {
  variableSideCapacity: string
  variableDeposited: string
  variableRemaining: string
  fixedSideCapacity: string
}

interface SerializedSnapshot {
  capturedAt: string
  vaults: SerializedVault[]
  ranges: Array<[string, FixedRange]>
}

const snapshot = rawSnapshot as unknown as SerializedSnapshot

/** Timestamp of the onchain state represented by the committed fixture. */
export const MOCK_CAPTURED_AT = Date.parse(snapshot.capturedAt)

/**
 * Rehydrate the bigint fields that JSON stores as decimal strings.
 * Returning fresh objects prevents UI sorting from mutating the imported fixture.
 */
export function loadMockVaults(): VariableVault[] {
  return snapshot.vaults.map((vault) => ({
    ...vault,
    variableSideCapacity: BigInt(vault.variableSideCapacity),
    variableDeposited: BigInt(vault.variableDeposited),
    variableRemaining: BigInt(vault.variableRemaining),
    fixedSideCapacity: BigInt(vault.fixedSideCapacity),
  }))
}

/** Return the captured Uniswap ranges keyed by lowercase vault address. */
export function loadMockRanges(): Map<string, FixedRange> {
  return new Map(snapshot.ranges.map(([address, range]) => [address.toLowerCase(), { ...range }]))
}
