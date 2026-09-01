// Standalone sanity check: hit the real Saffron factories and print how many vaults each holds,
// plus the variable-side snapshot of the first couple. No browser, no app imports.
// Run: node scripts/check-chain.mjs   (after npm install)
import { readFileSync } from 'node:fs'
import { createPublicClient, http } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'

// Minimal .env parse so we can use the QuickNode Ethereum endpoint without hardcoding the secret here.
const env = {}
try {
  for (const line of readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
  }
} catch { /* no .env — fall back to public RPCs */ }

const factoryAbi = [
  { inputs: [], name: 'nextVaultId', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  {
    inputs: [{ type: 'uint256' }], name: 'vaultInfo',
    outputs: [{ type: 'address' }, { type: 'address' }, { type: 'address' }, { type: 'uint256' }],
    stateMutability: 'view', type: 'function',
  },
]
const vaultAbi = [
  { inputs: [], name: 'variableAsset', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'variableSideCapacity', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'variableBearerToken', outputs: [{ type: 'address' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'isStarted', outputs: [{ type: 'bool' }], stateMutability: 'view', type: 'function' },
]
const erc20Abi = [
  { inputs: [], name: 'symbol', outputs: [{ type: 'string' }], stateMutability: 'view', type: 'function' },
  { inputs: [], name: 'totalSupply', outputs: [{ type: 'uint256' }], stateMutability: 'view', type: 'function' },
]

const targets = [
  { label: 'Ethereum', chain: mainnet, rpc: env.VITE_RPC_ETHEREUM || 'https://ethereum-rpc.publicnode.com',
    factories: ['0x7fE802B891734DB681b7353bFF9E6c85ce0ab200', '0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2'] },
  { label: 'Arbitrum', chain: arbitrum, rpc: env.VITE_RPC_ARBITRUM || 'https://arbitrum-one-rpc.publicnode.com',
    factories: ['0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2'] },
]

for (const t of targets) {
  const client = createPublicClient({ chain: t.chain, transport: http(t.rpc) })
  console.log(`\n=== ${t.label} (${t.rpc.split('/').slice(0, 3).join('/')}...) ===`)
  for (const factory of t.factories) {
    try {
      const next = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'nextVaultId' })
      const count = Number(next) - 1
      console.log(`  factory ${factory}: ${count} vault(s)`)
      for (let id = 1; id <= Math.min(count, 3); id++) {
        const [, vault] = await client.readContract({ address: factory, abi: factoryAbi, functionName: 'vaultInfo', args: [BigInt(id)] })
        const asset = await client.readContract({ address: vault, abi: vaultAbi, functionName: 'variableAsset' })
        const cap = await client.readContract({ address: vault, abi: vaultAbi, functionName: 'variableSideCapacity' })
        const bearer = await client.readContract({ address: vault, abi: vaultAbi, functionName: 'variableBearerToken' })
        const started = await client.readContract({ address: vault, abi: vaultAbi, functionName: 'isStarted' })
        const sym = await client.readContract({ address: asset, abi: erc20Abi, functionName: 'symbol' }).catch(() => '?')
        const dep = await client.readContract({ address: bearer, abi: erc20Abi, functionName: 'totalSupply' }).catch(() => 0n)
        console.log(`    #${id} ${vault}  variable=${sym}  deposited=${dep}  cap=${cap}  started=${started}`)
      }
    } catch (e) {
      console.log(`  factory ${factory}: ERROR ${e.shortMessage || e.message}`)
    }
  }
}
