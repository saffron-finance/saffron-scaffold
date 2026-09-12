/** Install the qualified wire fixture in one browser document. No API server or
 * reducer dependency is needed by a clean install of this standalone package. */
export function fixtureTransport(fixture) {
  const Q = 10n ** 36n
  const shift = (value, delta) => Array.isArray(value) ? value.map(item => shift(item, delta)) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).map(([k,v]) => [k,shift(v, delta)]))
    : typeof value === 'number' && value > 1e12 ? value + delta : value
  const actual = window.fetch.bind(window), streams = new Map(), receipts = new Map()
  let sequence = 1, admissions = 0, closes = 0, histories = 0, walletCalls = 0
  window.__documentId = crypto.randomUUID()
  const encode = (event, data) => new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  window.__aprFixture = {
    stats: () => ({ streams: streams.size, admissions, closes, histories, walletCalls }),
    send(value = 14555.78, unavailable = false) {
      for (const [poolId,{channel,first}] of streams) {
        const now = Date.now(), elapsedMs = BigInt(now - first.coverage.chainTimeMs)
        const feeReturnQ36 = String(BigInt(Math.round(value * 100)) * Q * elapsedMs / (31536000n * 10000n * 1000n))
        channel.enqueue(encode('snapshot', {
        ...first,poolId,sequence:String(++sequence),
        coverage:{...first.coverage,throughBlock:'101',chainTimeMs:now,headSelectedAtMs:Date.now()},
        cumulative:{swapCount:'21',lpFeeQuoteQ36:String(3n*Q),feeReturnQ36},
        ...(unavailable ? {observationAvailable:false,valuation:{...first.valuation,tvlQuoteQ36:null,poolPriceValid:false,reasonCode:'no_active_liquidity',activeLiquidity:'0'}} : {}),
        }))
      }
    },
  }
  window.fetch = async (input, options = {}) => {
    if (!String(input).includes('/api/live-apr/v2')) return actual(input, options)
    const body = options.body ? JSON.parse(options.body) : {}
    if (options.method === 'DELETE') { closes++; return new Response('{"released":true}') }
    if (String(input).endsWith('/sessions')) {
      // Admission can happen long after Home's layout checks. Anchor each pool
      // when entered so test duration cannot turn its first observation stale.
      const now = Date.now(), {first,baseline,control} = shift(fixture, now - fixture.now)
      admissions++; receipts.set(body.loadId,{poolId:body.poolId,first})
      return new Response(JSON.stringify({...body,sessionId:body.loadId,acceptedAtMs:now-31000,joinAtMs:now-31000,loadDeadlineMs:control.loadDeadlineMs,baseline:{...baseline,poolId:body.poolId},watcher:first.watcher,serverTimeMs:Date.now()}))
    }
    if (String(input).endsWith('/events')) {
      const {poolId,first}=receipts.get(options.headers['X-Session-ID'])
      return new Response(new ReadableStream({start(channel){
        streams.set(poolId,{channel,first});channel.enqueue(encode('snapshot',{...first,poolId}))
        const heartbeat=setInterval(()=>channel.enqueue(encode('status',{serverTimeMs:Date.now()})),1000)
        options.signal?.addEventListener('abort',()=>{clearInterval(heartbeat);streams.delete(poolId);channel.close()},{once:true})
      }}),{headers:{'content-type':'text/event-stream'}})
    }
    histories++
    return new Response(JSON.stringify({watcher:shift(fixture.first.watcher,Date.now()-fixture.now),serverTimeMs:Date.now(),rows:[],nextCursor:null,retainedFromMs:null,epoch:'1'}))
  }
}
