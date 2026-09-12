import { amountsForLiquidity } from '../shared/liquidity-math.mjs'
import { readVault } from '../shared/vault-reader.mjs'
import { sameAddress, MAX_HEAD_AGE } from '../shared/vault-lifecycle.mjs'

/** LP principal only: adapter liquidity survives maturity/ownership transfers
 * and decreases on withdrawal. Premium and accrued LP fees are excluded. */
export function principalUsd(snapshot, quoteAddress, quote, now=Date.now()) {
  if(!snapshot?.verified||!snapshot.canonical||!quote||!Number.isFinite(quote.checkedAt)
    ||now-quote.checkedAt>60_000||quote.checkedAt>now+5000||BigInt(quote.priceRaw)<=0n)throw new Error('TVL valuation unavailable')
  const liquidity=BigInt(snapshot.adapterLiquidity)
  if(liquidity===0n)return 0n
  const {token0,token1}=snapshot, square=BigInt(snapshot.sqrtPrice)**2n,Q=1n<<192n
  if(!sameAddress(quoteAddress,token0.address)&&!sameAddress(quoteAddress,token1.address))throw new Error('TVL quote asset mismatch')
  const quoted1=sameAddress(quoteAddress,token1.address),price=BigInt(quote.priceRaw)
  const price0=quoted1?price*square*10n**BigInt(token0.decimals)/(Q*10n**BigInt(token1.decimals)):price
  const price1=quoted1?price:price*Q*10n**BigInt(token1.decimals)/(square*10n**BigInt(token0.decimals))
  const amounts=amountsForLiquidity(liquidity,snapshot.sqrtPrice,snapshot.minTick,snapshot.maxTick)
  return amounts.amount0*price0/10n**BigInt(token0.decimals)+amounts.amount1*price1/10n**BigInt(token1.decimals)
}

/** One bounded background pass, one confirmed block for every campaign. Missing
 * evidence never becomes zero and cannot affect independent checkout readiness. */
export function createVaultTvl({db,rpc,usdQuote,confirmations=2,now=Date.now,read=readVault}) {
  let values=new Map(),pending=null,attemptedAt=-Infinity
  async function refresh(offers,{force=false}={}) {
    if(pending)return pending
    if(!force&&now()-attemptedAt<15_000)return
    attemptedAt=now()
    pending=(async()=>{
      const next=new Map(offers.map(offer=>[offer.id,{status:'available',usdRaw:'0',checkedAt:now(),block:null,priceCheckedAt:null}]))
      try {
        if(BigInt(await rpc('eth_chainId',[]))!==4663n)throw new Error('Wrong chain')
        const head=await rpc('eth_getBlockByNumber',['latest',false])
        if(!head?.hash||now()-Number(BigInt(head.timestamp))*1000>MAX_HEAD_AGE)throw new Error('Stale head')
        const height=BigInt(head.number)-BigInt(confirmations-1),tag='0x'+height.toString(16)
        const block=await rpc('eth_getBlockByNumber',[tag,false]);if(!block?.hash||height<0n)throw new Error('Block unavailable')
        for(const value of next.values())value.block={number:height.toString(),hash:block.hash}
        const pinned=(method,params)=>method==='eth_getBlockByNumber'&&params[0]==='latest'?Promise.resolve(head):rpc(method,params)
        const prices=new Map(),seen=new Set();let cursor=''
        for(;;){
          const rows=(await db.query(`SELECT i.id,q.program_id FROM saffron_incentives.deployment_intents i
            JOIN saffron_incentives.deployment_quotes q ON q.id=i.quote_id JOIN saffron_incentives.vault_jobs j ON j.intent_id=i.id
            WHERE j.plan ? 'vault' AND i.id::text>$1 ORDER BY i.id::text LIMIT 100`,[cursor])).rows
          let index=0
          await Promise.all(Array.from({length:Math.min(3,rows.length)},async()=>{while(index<rows.length){
            const row=rows[index++],value=next.get(row.program_id);if(!value)continue
            try{
              const job=await db.getIntent(row.id),address=job.plan.vault.toLowerCase()
              if(seen.has(address))throw new Error('Duplicate vault identity')
              seen.add(address)
              const snapshot=await read(job,pinned,{confirmations,now})
              if(snapshot.blockHash!==block.hash||snapshot.blockNumber!==height.toString())throw new Error('Incoherent block')
              const asset=job.snapshot.token1.address.toLowerCase()
              if(!prices.has(asset))prices.set(asset,usdQuote(asset))
              const quote=await prices.get(asset)
              value.usdRaw=(BigInt(value.usdRaw)+principalUsd(snapshot,asset,quote,now())).toString()
              value.priceCheckedAt=Math.min(value.priceCheckedAt??Infinity,quote.checkedAt)
            }catch{value.status='unavailable';value.usdRaw=null}
          }}))
          if(rows.length<100)break
          cursor=rows.at(-1).id
        }
        if((await rpc('eth_getBlockByNumber',[tag,false]))?.hash!==block.hash)throw new Error('Reorg')
        values=next
      }catch{values=new Map(offers.map(offer=>[offer.id,{...values.get(offer.id),status:values.has(offer.id)?'stale':'unavailable',checkedAt:now()}]))}
    })().finally(()=>pending=null)
    return pending
  }
  return {refresh,current(offers){
    void refresh(offers)
    return Object.fromEntries(offers.map(offer=>{const value=values.get(offer.id);return [offer.id,value?{...value,status:now()-value.checkedAt>30_000?'stale':value.status}:{status:'unavailable',usdRaw:null,checkedAt:null,block:null,priceCheckedAt:null}]}))
  }}
}
