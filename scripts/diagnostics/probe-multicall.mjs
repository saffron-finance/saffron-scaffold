import { readFileSync } from 'node:fs'
import { createPublicClient, http, defineChain } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'
const env = {}
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S+)/); if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
}
const MC3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const robinhood = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [env.VITE_RPC_ROBINHOOD] } } })
const chains = [
  { label: 'Ethereum', chain: mainnet, rpc: env.VITE_RPC_ETHEREUM },
  { label: 'Arbitrum', chain: arbitrum, rpc: env.VITE_RPC_ARBITRUM },
  { label: 'Robinhood', chain: robinhood, rpc: env.VITE_RPC_ROBINHOOD },
]
for (const t of chains) {
  const c = createPublicClient({ chain: t.chain, transport: http(t.rpc) })
  const code = await c.getCode({ address: MC3 }).catch(() => undefined)
  const has = code && code !== '0x'
  const builtin = t.chain.contracts?.multicall3?.address
  console.log(`${t.label.padEnd(10)} Multicall3 @ canonical: ${has ? 'PRESENT' : 'absent'}  | viem builtin: ${builtin || 'none'}`)
}
