import { useCallback } from 'react'
import type { Address } from 'viem'
import type { Deployment } from '../incentives/model'
import { requestJson } from './transport'
import { usePollingResource } from './usePollingResource'
export function useDeploymentStatus(account:Address,id:string){
  const load=useCallback(async(signal:AbortSignal):Promise<Deployment>=>(await requestJson('/deployments/'+id+'?wallet='+account,undefined,signal)).deployment,[account,id])
  return usePollingResource(account+id,load)
}
