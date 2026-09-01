import { defineChain, type Chain } from 'viem'
import { mainnet, arbitrum } from 'viem/chains'

// Robinhood Chain is an Arbitrum-Orbit L2 (chain id 4663). viem has no built-in def, so we declare it.
// Native currency + explorer taken from Saffron's config / the public Blockscout instance.
export const robinhoodChain: Chain = defineChain({
  id: 4663,
  name: 'Robinhood Chain',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    // No confirmed public RPC yet; supply one via VITE_RPC_ROBINHOOD (QuickNode) to enable this chain.
    default: { http: [] },
  },
  blockExplorers: {
    default: { name: 'Blockscout', url: 'https://robinhoodchain.blockscout.com' },
  },
  // Multicall3 is deployed at the canonical address (verified on-chain). viem ships it for
  // mainnet/arbitrum but not for this custom chain, so we declare it to enable batched reads.
  contracts: {
    multicall3: { address: '0xcA11bde05977b3631167028862bE2a173976CA11' },
  },
})

export type ChainKey = 'ethereum' | 'arbitrum' | 'robinhood'

export interface ChainDef {
  key: ChainKey
  label: string
  chain: Chain
  // Every factory to enumerate on this chain: the active one plus any legacy factories that still hold vaults.
  factories: `0x${string}`[]
  // Public RPC fallback used when the matching VITE_RPC_* env var is empty.
  publicRpc?: string
  explorer: string
}

// Keep this registry explicit: each entry is the single supported factory for its chain.
export const CHAINS: ChainDef[] = [
  {
    key: 'ethereum',
    label: 'Ethereum',
    chain: mainnet,
    factories: ['0x7fE802B891734DB681b7353bFF9E6c85ce0ab200'],
    publicRpc: 'https://ethereum-rpc.publicnode.com',
    explorer: 'https://etherscan.io',
  },
  {
    key: 'arbitrum',
    label: 'Arbitrum',
    chain: arbitrum,
    factories: ['0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2'], // active
    publicRpc: 'https://arbitrum-one-rpc.publicnode.com',
    explorer: 'https://arbiscan.io',
  },
  {
    key: 'robinhood',
    label: 'Robinhood Chain',
    chain: robinhoodChain,
    factories: ['0xb24b143ad6bB5bE9559CcC75f34A2261b7456904'], // active (RestrictedVaultFactory)
    publicRpc: undefined, // needs QuickNode (VITE_RPC_ROBINHOOD) or a confirmed public RPC
    explorer: 'https://robinhoodchain.blockscout.com',
  },
]

// The numeric chain id for a chain key (used for token-logo lookups by (chainId, address)).
export function chainIdFor(key: ChainKey): number {
  return CHAINS.find((c) => c.key === key)?.chain.id ?? 0
}

// Resolve the RPC url for a chain.
//  - Production build: always go through the same-origin `rpc/<chain>` proxy,
//    so provider credentials remain server-side.
//  - Dev: env override (the QuickNode URL in .env) wins, else the public fallback, else skip.
//
// The `import.meta.env.PROD` guard is a compile-time constant, so the dev branch below (which is the
// only place the secret VITE_RPC_* values are referenced) is dead-code-eliminated from the prod
// bundle — the tokens never ship to the browser. Static per-key access (not dynamic) is deliberate:
// a dynamic `import.meta.env[key]` would make Vite inline the whole env object and leak every token.
export function rpcFor(def: ChainDef): string | undefined {
  if (import.meta.env.PROD) {
    // document.baseURI respects either a root deployment or an optional
    // reverse-proxy prefix while keeping the request on the current origin.
    return new URL(`rpc/${def.key}`, document.baseURI).toString()
  }
  const devUrls: Record<ChainKey, string | undefined> = {
    ethereum: import.meta.env.VITE_RPC_ETHEREUM,
    arbitrum: import.meta.env.VITE_RPC_ARBITRUM,
    robinhood: import.meta.env.VITE_RPC_ROBINHOOD,
  }
  return devUrls[def.key]?.trim() || def.publicRpc
}
