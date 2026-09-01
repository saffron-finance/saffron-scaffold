// Diagnostic probe: surface the RAW RPC error for eth_getLogs so we can pick a strategy.
import { readFileSync } from 'node:fs'
import { createPublicClient, http, parseAbiItem, encodeEventTopics } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'

const env = {}
try {
  for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
  }
} catch {}

const evtAbi = [parseAbiItem('event FundsDeposited(uint256[] amounts, uint256 side, address indexed user)')]
const topics = encodeEventTopics({ abi: evtAbi, eventName: 'FundsDeposited' })
console.log('topic0:', topics[0])

const targets = [
  { label: 'Ethereum(QN)', chain: mainnet, rpc: env.VITE_RPC_ETHEREUM || 'https://ethereum-rpc.publicnode.com',
    vault: '0x9536c7E7fBD019f2a248368382AAcaA08cd9e6f6' },
  { label: 'Arbitrum(pub)', chain: arbitrum, rpc: 'https://arbitrum-one-rpc.publicnode.com',
    vault: '0x8B0646684B921421f9Cd61136C536D2897d0d615' },
  { label: 'Arbitrum(llama)', chain: arbitrum, rpc: 'https://arbitrum.llamarpc.com',
    vault: '0x8B0646684B921421f9Cd61136C536D2897d0d615' },
]

function toHex(n) { return '0x' + n.toString(16) }

for (const t of targets) {
  const c = createPublicClient({ chain: t.chain, transport: http(t.rpc) })
  let latest
  try { latest = await c.getBlockNumber() } catch (e) { console.log(`\n=== ${t.label}: getBlockNumber FAILED ${e.shortMessage} ===`); continue }
  console.log(`\n=== ${t.label} · latest=${latest} ===`)

  for (const win of [2_000n, 10_000n, 100_000n]) {
    const params = [{ address: t.vault, topics: [topics[0]], fromBlock: toHex(latest - win), toBlock: toHex(latest) }]
    try {
      const logs = await c.request({ method: 'eth_getLogs', params })
      console.log(`  raw eth_getLogs win ${win}: OK (${logs.length} logs)`)
    } catch (e) {
      const raw = e.cause?.message || e.details || e.shortMessage || e.message
      console.log(`  raw eth_getLogs win ${win}: ERR -> ${String(raw).slice(0, 140)}`)
    }
  }
}
