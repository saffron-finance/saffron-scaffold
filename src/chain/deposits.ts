import { type PublicClient, type Address, parseAbiItem } from 'viem'
import { clientFor } from './clients'
import { erc20Abi } from './abis'
import { type VariableVault } from './vaults'

// Variable-side deposits are enumerated from FundsDeposited logs where side == 1.
// Confirmed against UniV3Vault.sol: the variable branch emits amounts = [amount] (single element),
// side == 1, user indexed. The bearer token is minted 1:1 with the deposited amount.
const fundsDepositedEvent = parseAbiItem(
  'event FundsDeposited(uint256[] amounts, uint256 side, address indexed user)',
)

export interface Depositor {
  user: Address
  deposited: bigint // sum of variable-side amounts[0] across this depositor's deposit events (gross)
  current: bigint // bearer balanceOf(user) now — net of any withdrawal
  numDeposits: number
  lastBlock: bigint
  lastTime: number // unix seconds of the depositor's most recent deposit (0 if unresolved)
}

export interface DepositScan {
  depositors: Depositor[]
  totalDeposits: number
  partial: boolean // true if the scan was cut short (RPC range limit too tight for full history)
}

// --- block bounds -------------------------------------------------------------------------------
// Variable deposits can only happen BEFORE the vault starts (deposit() reverts once started). So for
// a started vault the scan's upper bound is the start block, not `latest` — this keeps the scanned
// range to the (short) funding window regardless of how long ago the vault matured. Cheap to find:
// endTime = startTime + duration is stored on-chain, so startTime = endTime - duration, and we
// binary-search the block whose timestamp first reaches it.
async function blockAtOrAfterTimestamp(client: PublicClient, targetTs: bigint, latest: bigint): Promise<bigint> {
  let lo = 0n
  let hi = latest
  while (lo < hi) {
    const mid = (lo + hi) / 2n
    let ts: bigint
    try {
      ts = (await client.getBlock({ blockNumber: mid })).timestamp
    } catch {
      return latest // can't resolve — fall back to scanning to head
    }
    if (ts < targetTs) lo = mid + 1n
    else hi = mid
  }
  return lo
}

// --- deployment-block detection (binary search on getCode) --------------------------------------
// Bounds the log scan tightly. Requires archive getCode; if that is unavailable we fall back to 0n
// and the scan simply covers the whole chain (slower, still correct).
const deployBlockCache = new Map<string, bigint>()

async function deploymentBlock(client: PublicClient, address: Address, latest: bigint): Promise<bigint> {
  const key = `${client.chain?.id}:${address.toLowerCase()}`
  const cached = deployBlockCache.get(key)
  if (cached !== undefined) return cached

  const hiCode = await client.getCode({ address, blockNumber: latest }).catch(() => undefined)
  if (!hiCode || hiCode === '0x') {
    deployBlockCache.set(key, 0n)
    return 0n
  }
  let lo = 0n
  let hi = latest
  while (lo < hi) {
    const mid = (lo + hi) / 2n
    let code: string | undefined
    try {
      code = await client.getCode({ address, blockNumber: mid })
    } catch {
      // archive not available at this depth — give up on precision, scan from 0
      deployBlockCache.set(key, 0n)
      return 0n
    }
    if (code && code !== '0x') hi = mid
    else lo = mid + 1n
  }
  deployBlockCache.set(key, lo)
  return lo
}

// --- windowed getLogs, fetched in parallel ------------------------------------------------------
const WINDOW = 9_000n // sits just under the common 10k getLogs cap (paid QuickNode confirmed at 10k)
const CONCURRENCY = 12 // parallel window fetches; paid endpoints handle this comfortably
const MAX_WINDOWS = 8000 // runaway backstop

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

type Logs = Awaited<ReturnType<PublicClient['getLogs']>>

// Fetch one [start,end] range. On a range-cap error it splits the range in half and recurses; on a
// transient error (rate limit) it retries with backoff. Returns [] and flags partial only if a
// single-block range keeps failing.
async function fetchRange(
  client: PublicClient,
  address: Address,
  start: bigint,
  end: bigint,
  flags: { partial: boolean },
): Promise<Logs> {
  let attempt = 0
  for (;;) {
    try {
      return await client.getLogs({ address, event: fundsDepositedEvent, fromBlock: start, toBlock: end })
    } catch (err) {
      const rangeLike = /range|limited to|too many|block range|more than|response size|invalid param/i.test(
        String((err as Error)?.message ?? ''),
      )
      if (rangeLike && end > start) {
        const mid = (start + end) / 2n
        const [a, b] = await Promise.all([
          fetchRange(client, address, start, mid, flags),
          fetchRange(client, address, mid + 1n, end, flags),
        ])
        return [...a, ...b]
      }
      if (++attempt >= 5) {
        flags.partial = true
        return []
      }
      await sleep(250 * attempt)
    }
  }
}

async function scanDepositLogs(client: PublicClient, address: Address, fromBlock: bigint, toBlock: bigint) {
  // Pre-compute the fixed windows, then drain them through a bounded-concurrency pool.
  const ranges: Array<[bigint, bigint]> = []
  for (let s = fromBlock; s <= toBlock && ranges.length <= MAX_WINDOWS; s += WINDOW) {
    ranges.push([s, s + WINDOW - 1n > toBlock ? toBlock : s + WINDOW - 1n])
  }
  const partial = { partial: ranges.length > MAX_WINDOWS }

  const logs: Logs = []
  let cursor = 0
  async function worker() {
    while (cursor < ranges.length) {
      const [s, e] = ranges[cursor++]
      logs.push(...(await fetchRange(client, address, s, e, partial)))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ranges.length) }, worker))
  return { logs, partial: partial.partial }
}

// --- public API ---------------------------------------------------------------------------------
const scanCache = new Map<string, DepositScan>()

export async function getVariableDepositors(v: VariableVault): Promise<DepositScan> {
  const cacheKey = `${v.chainKey}:${v.vault.toLowerCase()}`
  // A started/settled vault's deposit history is immutable → safe to cache. A vault still raising can
  // take new deposits, so always re-scan it.
  const immutable = v.isStarted || v.earningsSettled
  const cached = scanCache.get(cacheKey)
  if (cached && immutable) return cached

  const client = clientFor(v.chainKey)
  if (!client) throw new Error(`No RPC configured for ${v.chainKey}`)

  const latest = await client.getBlockNumber()
  const from = await deploymentBlock(client, v.vault, latest)

  // Upper bound: the start block for started vaults, else the chain head.
  let to = latest
  if (v.isStarted && v.endTime > 0 && v.durationSecs > 0) {
    const startTs = BigInt(v.endTime - v.durationSecs)
    const startBlock = await blockAtOrAfterTimestamp(client, startTs, latest)
    to = startBlock + 5n < latest ? startBlock + 5n : latest // small buffer for same-block start
  }

  const { logs, partial } = await scanDepositLogs(client, v.vault, from, to)

  const byUser = new Map<Address, Depositor>()
  let totalDeposits = 0
  for (const log of logs) {
    const args = (log as unknown as { args: { amounts?: bigint[]; side?: bigint; user?: Address } }).args
    if (args.side !== 1n) continue // variable side only
    const amount = args.amounts?.[0] ?? 0n
    const user = args.user as Address
    totalDeposits++
    const cur = byUser.get(user) ?? { user, deposited: 0n, current: 0n, numDeposits: 0, lastBlock: 0n, lastTime: 0 }
    cur.deposited += amount
    cur.numDeposits++
    if ((log.blockNumber ?? 0n) > cur.lastBlock) cur.lastBlock = log.blockNumber ?? 0n
    byUser.set(user, cur)
  }

  const depositors = [...byUser.values()]

  // Enrich: each depositor's current bearer balance (net of withdrawals) and last-deposit time.
  if (depositors.length > 0) {
    const balances = (await client
      .multicall({
        contracts: depositors.map((d) => ({ address: v.variableBearer, abi: erc20Abi, functionName: 'balanceOf', args: [d.user] })),
        allowFailure: true,
      })
      .catch(() => [])) as Array<{ status: string; result?: bigint }>
    depositors.forEach((d, i) => {
      if (balances[i]?.status === 'success') d.current = balances[i].result ?? 0n
    })

    // Resolve timestamps for the distinct last-deposit blocks (batched by the transport).
    const uniqueBlocks = [...new Set(depositors.map((d) => d.lastBlock))]
    const times = new Map<bigint, number>()
    await Promise.all(
      uniqueBlocks.map(async (bn) => {
        try {
          const block = await client.getBlock({ blockNumber: bn })
          times.set(bn, Number(block.timestamp))
        } catch {
          /* leave unresolved */
        }
      }),
    )
    depositors.forEach((d) => (d.lastTime = times.get(d.lastBlock) ?? 0))
  }

  const result: DepositScan = {
    depositors: depositors.sort((a, b) => (b.deposited > a.deposited ? 1 : -1)),
    totalDeposits,
    partial,
  }
  scanCache.set(cacheKey, result)
  return result
}
