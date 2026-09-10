import { decodeEventLog,encodeEventTopics } from 'viem'
import { abi } from '../shared/vault-lifecycle.mjs'

const zero='0x'+'0'.repeat(40)
const hex=value=>'0x'+value.toString(16)
const topics=encodeEventTopics({abi,eventName:'Transfer'})

/** Incremental discovery hints for the two fixed-position tokens. Balances,
 * never these hints, authorize actions. Each poll scans a bounded block range. */
export async function discoverPositionOwners(snapshot,previous,transactions,rpc,{blockSpan=2000n,maxRanges=4}={}){
  const tokens=[snapshot.claimToken,snapshot.fixedBearerToken].map(value=>value.toLowerCase())
  const head=BigInt(snapshot.blockNumber)
  let scan=previous?.positionScan,from=0n,owners={}
  if(scan&&tokens.every((token,i)=>token===scan.tokens[i])&&BigInt(scan.blockNumber)<=head
    &&(await rpc('eth_getBlockByNumber',[hex(BigInt(scan.blockNumber)),false]))?.hash===scan.blockHash){
    from=BigInt(scan.blockNumber)+1n;owners={...scan.owners}
  }else{
    scan=null
    const creation=transactions.find(tx=>tx.step==='create-vault'&&tx.receipt?.status==='0x1')?.receipt
    if(creation&&BigInt(creation.blockNumber)<=head
      &&(await rpc('eth_getBlockByNumber',[creation.blockNumber,false]))?.hash===creation.blockHash)from=BigInt(creation.blockNumber)
  }
  for(let range=0;from<=head&&range<maxRanges;range++){
    const end=from+blockSpan-1n<head?from+blockSpan-1n:head
    const logs=await rpc('eth_getLogs',[{address:tokens,topics,fromBlock:hex(from),toBlock:hex(end)}])
    logs.sort((a,b)=>BigInt(a.blockNumber)===BigInt(b.blockNumber)?Number(BigInt(a.logIndex)-BigInt(b.logIndex)):BigInt(a.blockNumber)<BigInt(b.blockNumber)?-1:1)
    for(const log of logs){
      if(log.removed||!tokens.includes(log.address.toLowerCase())||BigInt(log.blockNumber)<from||BigInt(log.blockNumber)>end)continue
      const event=decodeEventLog({abi,data:log.data,topics:log.topics})
      if(event.eventName==='Transfer'&&event.args.value>0n){
        const token=log.address.toLowerCase()
        if(event.args.to.toLowerCase()===zero)delete owners[token]
        else owners[token]=event.args.to.toLowerCase()
      }
    }
    const block=await rpc('eth_getBlockByNumber',[hex(end),false])
    if(!block?.hash)throw new Error('Position discovery block unavailable.')
    scan={tokens,owners:{...owners},blockNumber:end.toString(),blockHash:block.hash}
    from=end+1n
  }
  if((await rpc('eth_getBlockByNumber',[hex(head),false]))?.hash!==snapshot.blockHash)throw new Error('Position discovery block changed.')
  return {positionScan:scan,positionOwners:[...new Set(Object.values(owners))],positionsComplete:from>head}
}
