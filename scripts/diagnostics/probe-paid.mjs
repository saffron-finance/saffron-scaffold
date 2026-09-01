// Confirm the 3 paid QuickNode endpoints: vault counts + that getLogs range limit is lifted.
import { readFileSync } from 'node:fs'
import { createPublicClient, http, parseAbiItem, defineChain } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'

const env = {}
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
}

const robinhood = defineChain({
  id: 4663, name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [env.VITE_RPC_ROBINHOOD] } },
})

const factoryAbi = [
  { inputs: [], name: 'nextVaultId', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
]
const evt = parseAbiItem('event FundsDeposited(uint256[] amounts, uint256 side, address indexed user)')

const chains = [
  { label: 'Ethereum', chain: mainnet, rpc: env.VITE_RPC_ETHEREUM, factory: '0x7fE802B891734DB681b7353bFF9E6c85ce0ab200' },
  { label: 'Arbitrum', chain: arbitrum, rpc: env.VITE_RPC_ARBITRUM, factory: '0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2' },
  { label: 'Robinhood', chain: robinhood, rpc: env.VITE_RPC_ROBINHOOD, factory: '0xb24b143ad6bB5bE9559CcC75f34A2261b7456904' },
]

for (const t of chains) {
  const c = createPublicClient({ chain: t.chain, transport: http(t.rpc) })
  try {
    const latest = await c.getBlockNumber()
    const next = await c.readContract({ address: t.factory, abi: factoryAbi, functionName: 'nextVaultId' })
    let logsRange = 'n/a'
    for (const win of [50_000n, 10_000n, 5_000n, 1_000n]) {
      try {
        await c.getLogs({ address: t.factory, event: evt, fromBlock: latest - win, toBlock: latest })
        logsRange = `getLogs OK up to ${win} blocks`
        break
      } catch (e) {
        logsRange = `getLogs FAILS at ${win}: ${(e.details || e.shortMessage || e.message || '').slice(0, 70)}`
      }
    }
    console.log(`${t.label.padEnd(10)} latest=${String(latest).padStart(11)}  vaults=${Number(next) - 1}  | ${logsRange}`)
  } catch (e) {
    console.log(`${t.label.padEnd(10)} ERROR ${(e.shortMessage || e.message || '').split('\n')[0].slice(0, 80)}`)
  }
}
