import { useEffect, useState } from 'react'
import { parseAbi } from 'viem'
import { robinhoodClient } from './transport'
import type { Offer, PriceSnapshot } from '../incentives/model'

const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])
const MAX_SNAPSHOT_AGE = 120_000
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Read one pool at one block and validate its token identity/orientation.
 * The API timestamp is its response time, not an oracle round timestamp.
 * observedAt records when this observation began, never when review opens.
 */
export async function readOfferPrice(offer: Offer, signal: AbortSignal): Promise<PriceSnapshot> {
  if (offer.chainId !== 4663) throw new Error('Unsupported offer chain')
  const observedAt = new Date().toISOString()
  const block = await robinhoodClient.getBlockNumber()
  const call = { address: offer.pool, abi: poolAbi, blockNumber: block } as const
  const [slot, token0, token1, response] = await Promise.all([
    robinhoodClient.readContract({ ...call, functionName: 'slot0' }),
    robinhoodClient.readContract({ ...call, functionName: 'token0' }),
    robinhoodClient.readContract({ ...call, functionName: 'token1' }),
    fetch(`${import.meta.env.BASE_URL}prices/${offer.token1.address}`, { signal, cache: 'no-store' }),
  ])
  const payload = await response.json()
  const data = payload?.data
  const timestamp = Date.parse(data?.timestamp)
  if (!response.ok || !payload?.success || data?.chainId !== offer.chainId
    || typeof data.tokenAddress !== 'string' || !same(data.tokenAddress, offer.token1.address)
    || data.currency !== 'usd' || !Number.isFinite(data.price) || data.price <= 0
    || !Number.isFinite(timestamp) || timestamp > Date.now() + 60_000 || Date.now() - timestamp > 300_000) {
    throw new Error('Token USD price is unavailable or stale')
  }
  const forward = same(token0, offer.token0.address) && same(token1, offer.token1.address)
  const reversed = same(token1, offer.token0.address) && same(token0, offer.token1.address)
  if (!forward && !reversed) throw new Error('Pool token identity changed')
  const ratio = (Number(slot[0]) / 2 ** 96) ** 2
  const quotePerToken = (forward ? ratio : 1 / ratio) * 10 ** (offer.token0.decimals - offer.token1.decimals)
  if (!Number.isFinite(quotePerToken) || quotePerToken <= 0) throw new Error('Pool price unavailable')
  signal.throwIfAborted()
  return { quoteUsd: data.price, quotePerToken, observedAt, block: String(block) }
}

/** Poll only the selected pool. One refresh owns the state at a time; cleanup
 * and full chain/token identity prevent a prior offer's response leaking in.
 * Paid recovery never invokes this hook and does not require a live price.
 */
export function useOfferPrice(offer: Offer | null) {
  const identity = offer ? [offer.chainId, offer.pool, offer.token0.address, offer.token0.decimals,
    offer.token1.address, offer.token1.decimals].join(':').toLowerCase() : ''
  const [state, setState] = useState<{ identity: string; value?: PriceSnapshot; error?: string; loading: boolean }>({ identity: '', loading: false })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!offer) return
    const controller = new AbortController()
    let inFlight = false
    async function refresh() {
      if (inFlight) return
      inFlight = true
      // Never relabel an old pool's quote as belonging to the newly selected one.
      setState(current => ({ identity, loading: true,
        ...(current.identity === identity ? { value: current.value } : {}) }))
      try {
        const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)])
        const value = await readOfferPrice(offer!, signal)
        if (!signal.aborted) setState({ identity, loading: false, value })
      } catch {
        if (!controller.signal.aborted) setState({ identity, loading: false, error: 'Live price unavailable. Refresh to retry.' })
      } finally { inFlight = false }
    }
    void refresh()
    const timer = window.setInterval(() => void refresh(), 60_000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [identity, revision])
  const visible: typeof state = state.identity === identity ? state : { identity, loading: Boolean(offer) }
  const stale = visible.value && Date.now() - Date.parse(visible.value.observedAt) > MAX_SNAPSHOT_AGE
  return { ...visible, ...(stale ? { value: undefined, error: 'The price is stale. Refresh to retry.' } : {}),
    refresh: () => setRevision(value => value + 1) }
}
