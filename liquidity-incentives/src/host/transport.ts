import { createPublicClient, http } from 'viem'
import { arbitrum } from 'viem/chains'
import { robinhoodChain } from '@lab/chain/chains'

// Resolve this standalone server below the Vite mount. A fixed-income merge
// replaces the host boundary with the destination's chain-aware API client.
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '')
export const requestUrl = (suffix = '') => `${BASE}/vault-requests${suffix}`
export const arbitrumClient = createPublicClient({ chain: arbitrum,
  transport: http(`${BASE}/rpc/arbitrum`, { batch: true, timeout: 15_000 }) })
export const robinhoodClient = createPublicClient({ chain: robinhoodChain,
  transport: http(`${BASE}/rpc/robinhood`, { batch: true, timeout: 15_000 }) })

/** Same-origin JSON requests preserve existing login and API error handling. */
export async function requestJson(path: string, body?: object, signal?: AbortSignal) {
  const response = await fetch(requestUrl(path), { cache: 'no-store',
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
    ...(body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}) })
  const result = await response.json().catch(() => null)
  if (!response.ok || !result || typeof result !== 'object') {
    throw new Error(typeof result?.error === 'string' ? result.error : 'Requests are unavailable. Retry without paying again.')
  }
  return result
}
