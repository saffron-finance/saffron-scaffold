import { createPublicClient, http, type PublicClient } from 'viem'
import { CHAINS, rpcFor, type ChainKey, type ChainDef } from './chains'

// One viem public client per chain that has a usable RPC. Chains without an RPC (e.g. Robinhood until
// a QuickNode endpoint is supplied) are simply absent from the map and skipped by the loader.
const clients = new Map<ChainKey, PublicClient>()

for (const def of CHAINS) {
  const url = rpcFor(def)
  if (!url) continue
  clients.set(
    def.key,
    createPublicClient({ chain: def.chain, transport: http(url, { batch: true }) }),
  )
}

export function clientFor(key: ChainKey): PublicClient | undefined {
  return clients.get(key)
}

export function activeChains(): ChainDef[] {
  return CHAINS.filter((d) => clients.has(d.key))
}
