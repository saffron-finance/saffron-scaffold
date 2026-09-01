// Validate the variable-depositor scan + funding-window bounding on any chain, using the paid
// endpoints in .env. Usage: node scripts/list-depositors.mjs [ethereum|arbitrum|robinhood] [vaultAddr]
import { readFileSync } from 'node:fs'
import { createPublicClient, http, parseAbiItem, defineChain } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'

const env = {}
for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S+)/)
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
}
const robinhood = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [env.VITE_RPC_ROBINHOOD] } } })

const CHAINS = {
  ethereum: { chain: mainnet, rpc: env.VITE_RPC_ETHEREUM, vault: '0x9536c7E7fBD019f2a248368382AAcaA08cd9e6f6' },
  arbitrum: { chain: arbitrum, rpc: env.VITE_RPC_ARBITRUM, vault: '0x84F0c6e5A7ea3Bd89249f26A72b6E624344944Dd' },
  robinhood: { chain: robinhood, rpc: env.VITE_RPC_ROBINHOOD, vault: '0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2' },
}
const which = process.argv[2] || 'arbitrum'
const cfg = CHAINS[which]
const VAULT = process.argv[3] || cfg.vault
const evt = parseAbiItem('event FundsDeposited(uint256[] amounts, uint256 side, address indexed user)')
const vaultAbi = [
  { inputs: [], name: 'isStarted', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'endTime', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'duration', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'variableAsset', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
]
const erc20 = [{ inputs: [], name: 'decimals', outputs: [{ type: 'uint8' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' }]

const c = createPublicClient({ chain: cfg.chain, transport: http(cfg.rpc) })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function getBlockOfTs(target, latest) {
  let lo = 0n, hi = latest
  while (lo < hi) { const mid = (lo + hi) / 2n; const ts = (await c.getBlock({ blockNumber: mid })).timestamp; if (ts < target) lo = mid + 1n; else hi = mid }
  return lo
}
async function deployBlock(address, latest) {
  const hc = await c.getCode({ address, blockNumber: latest }).catch(() => undefined)
  if (!hc || hc === '0x') return 0n
  let lo = 0n, hi = latest
  while (lo < hi) { const mid = (lo + hi) / 2n; let code; try { code = await c.getCode({ address, blockNumber: mid }) } catch { return 0n } if (code && code !== '0x') hi = mid; else lo = mid + 1n }
  return lo
}
async function getWindow(address, s, e) { let a = 0; for (;;) { try { return await c.getLogs({ address, event: evt, fromBlock: s, toBlock: e }) } catch (err) { if (++a >= 3) throw err; await sleep(250 * a) } } }
async function scan(address, from, to) {
  const W = 9_000n, N = 12, ranges = []
  for (let s = from; s <= to; s += W) ranges.push([s, s + W - 1n > to ? to : s + W - 1n])
  const logs = []; let cur = 0
  await Promise.all(Array.from({ length: Math.min(N, ranges.length) }, async () => { while (cur < ranges.length) { const [s, e] = ranges[cur++]; logs.push(...(await getWindow(address, s, e))) } }))
  return logs
}

const latest = await c.getBlockNumber()
const [isStarted, endTime, duration, asset] = await Promise.all([
  c.readContract({ address: VAULT, abi: vaultAbi, functionName: 'isStarted' }),
  c.readContract({ address: VAULT, abi: vaultAbi, functionName: 'endTime' }),
  c.readContract({ address: VAULT, abi: vaultAbi, functionName: 'duration' }),
  c.readContract({ address: VAULT, abi: vaultAbi, functionName: 'variableAsset' }),
])
const [dec, sym] = await Promise.all([
  c.readContract({ address: asset, abi: erc20, functionName: 'decimals' }).catch(() => 18),
  c.readContract({ address: asset, abi: erc20, functionName: 'symbol' }).catch(() => '?'),
])
const from = await deployBlock(VAULT, latest)
let to = latest
if (isStarted && endTime > 0n && duration > 0n) { const startBlock = await getBlockOfTs(endTime - duration, latest); to = startBlock + 5n }
console.log(`${which} vault ${VAULT}`)
console.log(`  started=${isStarted}  deploy=${from}  latest=${latest}`)
console.log(`  UNBOUNDED span: ${latest - from} blocks (${Math.ceil(Number(latest - from) / 9000)} windows)`)
console.log(`  BOUNDED   span: ${to - from} blocks (${Math.ceil(Number(to - from) / 9000)} windows)  ${isStarted ? '← funding window only' : '(not started, = head)'}`)

const t0 = Date.now()
const logs = await scan(VAULT, from, to)
const byUser = new Map()
for (const l of logs) { if (l.args.side !== 1n) continue; byUser.set(l.args.user, (byUser.get(l.args.user) ?? 0n) + (l.args.amounts?.[0] ?? 0n)) }
const sorted = [...byUser.entries()].sort((a, b) => (b[1] > a[1] ? 1 : -1))
console.log(`  scanned in ${((Date.now() - t0) / 1000).toFixed(1)}s → ${sorted.length} variable depositor(s) in ${sym}:`)
for (const [u, amt] of sorted.slice(0, 10)) console.log(`    ${u}  ${(Number(amt) / 10 ** Number(dec)).toLocaleString()}`)
