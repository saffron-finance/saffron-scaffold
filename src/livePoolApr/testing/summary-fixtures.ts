import type { Baseline, Snapshot, WatcherStatus } from '../contracts'

export const Q = 10n ** 36n
export const watcher: WatcherStatus = {
  state: 'watching',
  runGeneration: '1',
  statusVersion: '1',
  loadDeadlineMs: 1_201_000,
  pausedAtMs: null,
  pauseReason: null,
}
export function fixtureSnapshot(sequence = 1, overrides: Partial<Snapshot> = {}): Snapshot {
  return {
    schemaVersion: 2,
    poolId: 'cashcat-eth-1',
    chainId: '4663',
    datasetGeneration: 'db-a',
    epoch: '1',
    sequence: String(sequence),
    lastSwap:
      sequence > 1
        ? {
            block: String(sequence * 10),
            blockHash: '0x' + 'a'.repeat(64),
            chainTimeMs: sequence * 30_000,
          }
        : null,
    coverage: {
      fromBlock: '1',
      throughBlock: String(sequence * 10),
      blockHash: '0x' + 'a'.repeat(64),
      chainTimeMs: sequence * 30_000,
      headSelectedAtMs: sequence * 30_000,
      committedAtMs: sequence * 30_000,
      provisional: true,
    },
    cumulative: {
      swapCount: String(sequence * 2),
      lpFeeQuoteQ36: String(BigInt(sequence) * Q),
      feeReturnQ36: String((BigInt(sequence) * Q) / 1000n),
    },
    valuation: {
      tvlQuoteQ36: String(1000n * Q),
      quoteUsdQ36: String(2000n * Q),
      quoteTimeMs: sequence * 30_000,
      quoteValid: true,
      block: String(sequence * 10),
      method: 'batch-principal',
    },
    observationAvailable: true,
    history: { latestCursor: null, retainedFromMs: 0 },
    quality: { state: 'fresh', lagMs: 0, reasonCode: null },
    watcher,
    ...overrides,
  }
}
export function fixtureBaseline(snapshot = fixtureSnapshot()): Baseline {
  return {
    baselineId: `base-${snapshot.epoch}`,
    datasetGeneration: snapshot.datasetGeneration,
    epoch: snapshot.epoch,
    sequence: snapshot.sequence,
    coverage: snapshot.coverage,
    cumulative: snapshot.cumulative,
  }
}
