import { readFileSync } from 'node:fs'
import { createPublicClient, http, defineChain } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'
const env = {}
for (const line of readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S+)/); if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
}
const MC3 = '0xcA11bde05977b3631167028862bE2a173976CA11'
const robinhood = defineChain({ id: 4663, name: 'Robinhood Chain', nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [env.VITE_RPC_ROBINHOOD] } }, contracts: { multicall3: { address: MC3 } } })
const factoryAbi = [
  { inputs: [], name: 'nextVaultId', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [{ type: 'uint256' }], name: 'vaultInfo', outputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }], stateMutability: 'view', type: 'function' },
]
const vaultAbi = ['variableAsset','variableBearerToken','variableSideCapacity','isStarted'].map(n => ({ inputs: [], name: n, outputs: [{ type: n === 'isStarted' ? 'bool' : (n === 'variableSideCapacity' ? 'uint256' : 'address') }], stateMutability: 'view', type: 'function' }))
const chains = [
  { label: 'Ethereum', chain: mainnet, rpc: env.VITE_RPC_ETHEREUM, factories: ['0x7fE802B891734DB681b7353bFF9E6c85ce0ab200', '0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2'] },
  { label: 'Arbitrum', chain: arbitrum, rpc: env.VITE_RPC_ARBITRUM, factories: ['0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2'] },
  { label: 'Robinhood', chain: robinhood, rpc: env.VITE_RPC_ROBINHOOD, factories: ['0xb24b143ad6bB5bE9559CcC75f34A2261b7456904'] },
]
const t0 = Date.now()
await Promise.all(chains.map(async t => {
  const c = createPublicClient({ chain: t.chain, transport: http(t.rpc, { batch: true }) })
  const ct0 = Date.now()
  let total = 0
  for (const factory of t.factories) {
    const next = await c.readContract({ address: factory, abi: factoryAbi, functionName: 'nextVaultId' })
    const ids = Array.from({ length: Number(next) - 1 }, (_, i) => i + 1)
    const infos = await c.multicall({ contracts: ids.map(id => ({ address: factory, abi: factoryAbi, functionName: 'vaultInfo', args: [BigInt(id)] })), allowFailure: true })
    const vaults = infos.filter(r => r.status === 'success').map(r => r.result[1])
    const res = await c.multicall({ contracts: vaults.flatMap(v => vaultAbi.map(a => ({ address: v, abi: [a], functionName: a.name }))), allowFailure: true })
    const okc = res.filter(r => r.status === 'success').length
    total += vaults.length
    console.log(`  ${t.label} factory ${factory.slice(0,10)}: ${vaults.length} vaults, ${okc}/${res.length} getter reads ok`)
  }
  console.log(`${t.label.padEnd(10)} ${total} vaults in ${((Date.now()-ct0)/1000).toFixed(1)}s`)
}))
console.log(`\nALL CHAINS loaded in ${((Date.now()-t0)/1000).toFixed(1)}s`)
