/** Add the disposable wallet's canonical lifecycle without restarting its fixture.
 * The worker's `created` state records creation, not claim/withdrawal completion.
 * Only read-only, fixed-path GETs to the root-owned fixture's loopback origin are
 * permitted. Failures remain explicitly unknown rather than implying completion.
 */
export function fixtureOrigin(data){
  const origin=new URL(data.origin)
  if(data.environment!=='Disposable local contracts; NOT mainnet'||data.chainId!==4663||
    origin.protocol!=='http:'||origin.hostname!=='127.0.0.1'||!origin.port||
    origin.origin!==data.origin||origin.username||origin.password||
    !/^0x[0-9a-f]{40}$/i.test(data.user))throw Error('Unexpected test session origin')
  return origin
}

export async function withPositionStatus(payload,{fetcher=fetch}={}){
  if(!payload.ok)return payload
  const data=payload.result,origin=fixtureOrigin(data)

  // Each request has its own bounded lifetime. The browser and server cannot
  // follow redirects into another application or forward credentials anywhere.
  const jobs=await Promise.all(data.jobs.map(async job=>{
    try{
      if(!/^[0-9a-f-]{36}$/i.test(job.id))throw Error('Invalid request identifier')
      const url=new URL('/api/incentives/deployments/'+job.id,origin)
      url.searchParams.set('wallet',data.user)
      const response=await fetcher(url,{method:'GET',redirect:'error',signal:AbortSignal.timeout(7000)})
      if(!response.ok)throw Error('Position unavailable')
      const {deployment}=await response.json()
      if(deployment?.id!==job.id||deployment.positionWallet?.toLowerCase()!==data.user.toLowerCase())throw Error('Position identity mismatch')
      const observation=deployment.observation
      return {...job,position:{available:true,state:deployment.state,
        verified:observation?.verified===true&&observation?.canonical===true,
        canClaim:deployment.canClaim===true,canWithdraw:deployment.canWithdraw===true,
        depositable:deployment.depositable===true,
        observedBlock:observation?.blockNumber??null,blockTimestamp:observation?.blockTimestamp??null,
        claimBalanceRaw:observation?.claimBalance??null,fixedBalanceRaw:observation?.fixedBalance??null}}
    }catch{return {...job,position:{available:false,state:'unavailable',verified:false}}}
  }))
  return {...payload,result:{...data,jobs,checkedAt:new Date().toISOString()}}
}
