import { readFile } from 'node:fs/promises'
import { decodeFunctionResult,encodeFunctionData,parseAbi } from 'viem'
import { CHAIN_ID,FACTORY,fault,validAddress } from '../shared/incentives.mjs'

export const FEE_TIERS=[100,500,3000,10000]
const tokenListUrl='https://tokens.coingecko.com/robinhood/all.json'
const abi=parseAbi(['function name() view returns(string)','function symbol() view returns(string)',
  'function decimals() view returns(uint8)','function positionManager() view returns(address)',
  'function factory() view returns(address)','function getPool(address,address,uint24) view returns(address)',
  'function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)'])

/** Token lists are discovery hints, never authority for addresses or decimals.
 * Bound external data and use only an operator-owned URL; no caller URL is fetched. */
export function listToken(value){
  if(value?.chainId!==CHAIN_ID||!validAddress(value.address)||!Number.isInteger(value.decimals)
    ||value.decimals<0||value.decimals>18||!/^\S.{0,99}$/u.test(value.symbol??''))return null
  return {address:value.address.toLowerCase(),symbol:value.symbol.slice(0,100),decimals:value.decimals,
    name:typeof value.name==='string'?value.name.slice(0,120):value.symbol,
    ...(typeof value.logoURI==='string'&&/^https:\/\//.test(value.logoURI)&&value.logoURI.length<1000?{logoURI:value.logoURI}:{})}
}

/** Read-only operator discovery. One block anchors token and pool reads; derive
 * the Uniswap factory from Saffron's configured position manager, including forks. */
export function createPairDiscovery({rpc,fetchList=fetch,now=Date.now}){
  let cached=null,pending=null
  const read=async(address,name,block,args=[])=>decodeFunctionResult({abi,functionName:name,
    data:await rpc('eth_call',[{to:address,data:encodeFunctionData({abi,functionName:name,args})},block])})
  async function block(){
    if(BigInt(await rpc('eth_chainId',[]))!==BigInt(CHAIN_ID))throw fault(503,'Robinhood RPC is unavailable.')
    return rpc('eth_blockNumber',[])
  }
  async function metadata(address,at){
    if(!validAddress(address))throw fault(400,'Paste a valid token contract address.')
    try{
      const [symbol,decimals,name]=await Promise.all([read(address,'symbol',at),read(address,'decimals',at),read(address,'name',at).catch(()=>null)])
      // This is the same supported ERC-20 metadata domain as campaign admission.
      if(!/^[A-Za-z0-9._-]{1,20}$/.test(symbol)||Number(decimals)>18)throw new Error()
      return {address:address.toLowerCase(),symbol,decimals:Number(decimals),name:typeof name==='string'?name.slice(0,120):symbol}
    }catch{throw fault(400,'Cannot read supported ERC-20 metadata at this Robinhood address.')}
  }
  return {
    async tokens(){
      if(cached&&cached.until>now())return cached.value
      if(pending)return pending
      pending=(async()=>{
        const fallback=JSON.parse(await readFile(new URL('./robinhood-tokens.json',import.meta.url),'utf8')).tokens
        let source='fallback',remote=[]
        try{
          const response=await fetchList(tokenListUrl,{signal:AbortSignal.timeout(6000),redirect:'error'})
          if(!response.ok)throw new Error()
          let bytes=0;const chunks=[]
          for await(const chunk of response.body){bytes+=chunk.length;if(bytes>4_000_000)throw new Error();chunks.push(chunk)}
          const body=JSON.parse(Buffer.concat(chunks).toString('utf8'))
          if(!Array.isArray(body.tokens)||body.tokens.length>10000)throw new Error()
          remote=body.tokens;source='coingecko'
        }catch{ /* The canonical fallback and address lookup remain available. */ }
        const tokens=[...new Map([...remote,...fallback].map(listToken).filter(Boolean).map(t=>[t.address,t])).values()]
        const value={tokens,source,chainId:CHAIN_ID}
        cached={value,until:now()+(source==='fallback'?60_000:3600_000)};return value
      })().finally(()=>{pending=null})
      return pending
    },
    async token(address){return {token:await metadata(address,await block())}},
    async pools(address0,address1){
      if(!validAddress(address0)||!validAddress(address1)||address0.toLowerCase()===address1.toLowerCase())throw fault(400,'Choose two different token contracts.')
      const at=await block(),[token0,token1]=await Promise.all([metadata(address0,at),metadata(address1,at)])
      const manager=await read(FACTORY,'positionManager',at),factory=await read(manager,'factory',at)
      const pools=(await Promise.all(FEE_TIERS.map(async feeTier=>{
        const pool=await read(factory,'getPool',at,[token0.address,token1.address,feeTier])
        if(!validAddress(pool))return null
        const [a,b,fee]=await Promise.all([read(pool,'token0',at),read(pool,'token1',at),read(pool,'fee',at)])
        if(Number(fee)!==feeTier||new Set([a.toLowerCase(),b.toLowerCase()]).size!==2
          ||![a,b].every(t=>[token0.address,token1.address].includes(t.toLowerCase())))throw fault(503,'Pool metadata could not be verified.')
        return {pool:pool.toLowerCase(),feeTier}
      }))).filter(Boolean)
      return {token0,token1,pools,block:at,chainId:CHAIN_ID}
    },
  }
}
