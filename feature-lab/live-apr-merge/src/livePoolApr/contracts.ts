/** Shared browser/native-Node transport boundary. The wire shape is shared with
 * the producer; this browser also binds identity to its selected local catalog. */
export * from '@packages/api-types/live-pool-apr.mjs'
import { validSnapshot as validWireSnapshot } from '@packages/api-types/live-pool-apr.mjs'
import type { Snapshot } from '@packages/api-types/live-pool-apr.mjs'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'

const chains = new Map(pools.map(pool => [pool.id, String(pool.chainId)]))
/** Reject cross-chain identity substitution and overlong diagnostic text before
 * retaining the snapshot in React/session state. Unknown fields remain bounded
 * by the shared whole-snapshot byte limit. */
export function validSnapshot(value: unknown, poolId: string): value is Snapshot {
  if (!validWireSnapshot(value, poolId)) return false
  const snapshot = value as Snapshot
  return snapshot.chainId === chains.get(poolId) &&
    typeof snapshot.datasetGeneration === 'string' && snapshot.datasetGeneration.length <= 128 &&
    [snapshot.quality.state, snapshot.quality.reasonCode, snapshot.valuation.method,
      snapshot.valuation.reasonCode, snapshot.watcher.pauseReason].every(text =>
      text == null || typeof text === 'string' && text.length <= 256)
}
