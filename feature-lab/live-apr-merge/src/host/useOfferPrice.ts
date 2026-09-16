import { useEffect, useState } from 'react'
import { parseAbi } from 'viem'
import { createPriceReadClient } from './transport'
import type { Offer, PriceSnapshot } from '../incentives/model'

const poolAbi = parseAbi([
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function token0() view returns (address)',
  'function token1() view returns (address)',
])
const PREVIEW_REFRESH_MS = 120_000
const MAX_SNAPSHOT_AGE = 300_000
const RETRY_BACKOFF_MS = 10_000
const METADATA_TTL_MS = 30 * 60_000
const MAX_POOLS = 128
const identityOf = (offer: Offer) => [offer.chainId,offer.pool,offer.token0.address,offer.token0.decimals,
  offer.token1.address,offer.token1.decimals].join(':').toLowerCase()
// Per-tab reuse prevents focus/reopen/manual refresh from making the same read.
const snapshots = new Map<string,{value?:PriceSnapshot;pending?:Promise<PriceSnapshot>;retryAt?:number}>()
const metadata = new Map<string,{at:number;tokens:Promise<readonly [string,string]>}>()
function trim(map:Map<string,unknown>){while(map.size>MAX_POOLS)map.delete(map.keys().next().value!)}

/** Pool token identity is immutable. Revalidate on identity/revision changes or
 * after 30 minutes, not on every slot0 observation. Failures are never retained. */
async function poolTokens(offer:Offer,call:any,client:ReturnType<typeof createPriceReadClient>):Promise<readonly [string,string]>{
  const key=identityOf(offer)+':'+offer.pairRevision,previous=metadata.get(key)
  if(previous&&Date.now()-previous.at<METADATA_TTL_MS)return previous.tokens
  const tokens=Promise.all([
    client.readContract({...call,functionName:'token0'}),
    client.readContract({...call,functionName:'token1'}),
  ]) as Promise<[string,string]>
  const entry={at:Date.now(),tokens};metadata.set(key,entry);trim(metadata)
  try{return await tokens}catch(error){if(metadata.get(key)===entry)metadata.delete(key);throw error}
}

/** Consumer cancellation leaves shared work alive for the other open modal. */
function waitForPrice<T>(work:Promise<T>,signal:AbortSignal):Promise<T>{
  return new Promise((resolve,reject)=>{
    const cancel=()=>reject(signal.reason??new Error('Price request cancelled'))
    signal.addEventListener('abort',cancel,{once:true})
    if(signal.aborted)cancel()
    work.then(resolve,reject).finally(()=>signal.removeEventListener('abort',cancel))
  })
}

/** Coalesce callers without allowing one closed modal to abort another caller.
 * Every shared request has its own bounded timeout; each consumer still checks
 * its cancellation before receiving a value. Error cooldown limits outage spam. */
export async function readOfferPrice(offer:Offer,signal:AbortSignal):Promise<PriceSnapshot>{
  signal.throwIfAborted()
  const key=identityOf(offer)+':'+offer.pairRevision,entry=snapshots.get(key)
  if(entry?.value&&Date.now()-Date.parse(entry.value.observedAt)<PREVIEW_REFRESH_MS)return entry.value
  if(entry?.retryAt&&Date.now()<entry.retryAt)throw new Error('Price refresh is cooling down. Retry shortly.')
  let work=entry?.pending
  if(!work){
    const next:{value?:PriceSnapshot;pending?:Promise<PriceSnapshot>;retryAt?:number}={}
    const controller=new AbortController()
    const timer=setTimeout(()=>controller.abort(new Error('Price preview timed out')),30_000)
    work=waitForPrice(loadOfferPrice(offer,controller.signal),controller.signal).finally(()=>clearTimeout(timer)).then(value=>{
      next.value=value;delete next.pending;return value
    },error=>{delete next.pending;next.retryAt=Date.now()+RETRY_BACKOFF_MS;throw error})
    next.pending=work;snapshots.set(key,next);trim(snapshots)
  }
  return waitForPrice(work,signal)
}
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase()

/** Read one pool at one block and validate its token identity/orientation.
 * The API timestamp is its response time, not an oracle round timestamp.
 * observedAt records when this observation began, never when review opens.
 */
async function loadOfferPrice(offer: Offer, signal: AbortSignal): Promise<PriceSnapshot> {
  if (offer.chainId !== 4663) throw new Error('Unsupported offer chain')
  const observedAt = new Date().toISOString()
  const client=createPriceReadClient(signal)
  const block = await waitForPrice(client.getBlockNumber(),signal)
  signal.throwIfAborted()
  const call = { address: offer.pool, abi: poolAbi, blockNumber: block } as const
  const [slot, [token0, token1], response] = await Promise.all([
    client.readContract({ ...call, functionName: 'slot0' }),
    poolTokens(offer,call,client),
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
  if (!forward && !reversed){metadata.delete(identityOf(offer)+':'+offer.pairRevision);throw new Error('Pool token identity changed')}
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
  const identity = offer ? identityOf(offer)+':'+offer.pairRevision : ''
  const [state, setState] = useState<{ identity: string; value?: PriceSnapshot; error?: string; loading: boolean }>({ identity: '', loading: false })
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!offer) return
    const controller = new AbortController()
    let inFlight = false
    async function refresh() {
      if (inFlight || document.hidden) return
      const cached=snapshots.get(identity)?.value
      if(cached&&Date.now()-Date.parse(cached.observedAt)<PREVIEW_REFRESH_MS){setState({identity,loading:false,value:cached});return}
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
    const timer = window.setInterval(() => void refresh(), PREVIEW_REFRESH_MS)
    const focus = () => void refresh()
    window.addEventListener('focus', focus);document.addEventListener('visibilitychange',focus)
    return () => { controller.abort(); window.clearInterval(timer); window.removeEventListener('focus', focus);document.removeEventListener('visibilitychange',focus) }
  }, [identity, revision])
  const visible: typeof state = state.identity === identity ? state : { identity, loading: Boolean(offer) }
  const stale = visible.value && Date.now() - Date.parse(visible.value.observedAt) > MAX_SNAPSHOT_AGE
  return { ...visible, ...(stale ? { value: undefined, error: 'The price is stale. Refresh to retry.' } : {}),
    refresh: () => setRevision(value => value + 1) }
}
