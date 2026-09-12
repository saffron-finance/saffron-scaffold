/** Public version-2 transport types. Integers stay strings until presentation. */
export interface Coverage {
  fromBlock: string
  throughBlock: string
  blockHash: string
  chainTimeMs: number
  headSelectedAtMs: number
  committedAtMs: number
  provisional: boolean
}
export interface Cumulative {
  swapCount: string
  lpFeeQuoteQ36: string
  feeReturnQ36: string
}
export interface WatcherStatus {
  datasetGeneration?: string
  // Both expiry spellings have shipped in the migration contract. They mean the
  // same intentional pause; accepting either must never renew server interest.
  state:
    | 'idle_no_viewers'
    | 'starting'
    | 'watching'
    | 'paused_interest_expired'
    | 'paused_recent_load_expired'
    | 'paused_control_unavailable'
  runGeneration: string
  statusVersion: string
  loadDeadlineMs: number
  pausedAtMs: number | null
  pauseReason: string | null
}
export interface Snapshot {
  schemaVersion: 2
  poolId: string
  chainId: string
  datasetGeneration: string
  epoch: string
  sequence: string
  lastSwap: { block: string; blockHash: string; chainTimeMs: number } | null
  coverage: Coverage
  cumulative: Cumulative
  valuation: {
    tvlQuoteQ36: string | null
    poolPriceValid?: boolean
    reasonCode?: string | null
    activeLiquidity?: string | null
    block: string
    method: string
    quoteUsdQ36: string | null
    quoteTimeMs: number | null
    quoteValid: boolean
  }
  observationAvailable: boolean
  history: { latestCursor: string | null; retainedFromMs: number | null }
  quality: { state: string; lagMs: number; reasonCode: string | null }
  watcher: WatcherStatus
}
export interface Baseline {
  baselineId: string
  poolId?: string
  datasetGeneration: string
  epoch: string
  sequence: string
  coverage: Coverage
  cumulative: Cumulative
}
export interface Receipt {
  sessionId: string
  loadId: string
  poolId: string
  acceptedAtMs: number
  loadDeadlineMs: number
  joinAtMs: number
  baseline: Baseline | null
  watcher: WatcherStatus
}
export interface HistoryRow {
  id: string
  block: number | string
  timestamp: number
  transactionHash: string
  inputIs0: boolean
  inputAmount?: number | string
  lpFeeQuote?: number
  feeReturn?: number
  lpFeeQuoteQ36: string
  feeReturnQ36: string
}
export interface HistoryPage {
  rows: HistoryRow[]
  nextCursor: string | null
  retainedFromMs: number | null
  epoch: string
}

export const Q36: bigint
export const MAX_SNAPSHOT_BYTES: number
export function decimalQ36(value: number | string): bigint
export function validateSnapshot(value: unknown): string
export function compareVersion(
  left: Pick<Snapshot, 'datasetGeneration' | 'epoch' | 'sequence'>,
  right: Pick<Snapshot, 'datasetGeneration' | 'epoch' | 'sequence'>
): number
export function validWatcher(value: unknown): value is WatcherStatus
export function validBaseline(value: unknown): value is Baseline
export function validSnapshot(value: unknown, poolId: string): value is Snapshot
