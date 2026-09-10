import { parseUnits } from 'viem'
import { WETH,sameAddress,CHAIN_ID } from '../shared/vault-lifecycle.mjs'

/** Explicit external USD provider. Only catalog quote assets may be queried. */
export function createPriceService({database,root,now=Date.now}){
  const cache=new Map(),pending=new Map()
  async function payload(address){
    const token=address.toLowerCase()===WETH.toLowerCase()?{address:WETH.toLowerCase(),symbol:'ETH',decimals:18}:await database?.quoteToken(address)
    if(!token||!root)throw new Error('Pricing is not configured for this token.')
    const cached=cache.get(token.address)
    if(cached&&now()-cached.at<5000)return cached.value
    if(pending.has(token.address))return pending.get(token.address)
    const work=(async()=>{
      const url=new URL(root.replace(/\/$/,'')+'/'+token.address+'/price')
      url.searchParams.set('symbol',token.symbol)
      const response=await fetch(url,{signal:AbortSignal.timeout(15_000),redirect:'error'})
      const value=await response.json(),data=value?.data,time=Date.parse(data?.timestamp)
      if(!response.ok||!value.success||!sameAddress(data?.tokenAddress,token.address)||data.chainId!==CHAIN_ID||data.currency!=='usd'
        ||!Number.isFinite(data.price)||data.price<=0||!Number.isFinite(time)||now()-time>60_000||time>now()+5000)throw new Error('Fresh USD pricing is unavailable.')
      // Return only the documented public fields, never provider metadata.
      const result={success:true,data:{chainId:CHAIN_ID,tokenAddress:token.address,currency:'usd',price:data.price,timestamp:data.timestamp}}
      cache.set(token.address,{at:now(),value:result});return result
    })().finally(()=>pending.delete(token.address))
    pending.set(token.address,work);return work
  }
  return {payload,quote:async address=>{const {data}=await payload(address);return {priceRaw:parseUnits(data.price.toFixed(18),18).toString(),checkedAt:Date.parse(data.timestamp)}}}
}
