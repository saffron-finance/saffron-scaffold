import { useEffect,useState } from 'react'
import type { Address } from 'viem'
import type { Deployment } from '../incentives/model'
import { readSession,ensureSession,requestJson,type WalletSession } from './transport'

type OperatorStatus={signer:string;gasBalanceRaw:string|null;pending:number;stalled:number;workerOnline:boolean}
export function useDeployments(account:Address|null,admin=false){
  const [rows,setRows]=useState<Deployment[]>([]),[session,setSession]=useState<WalletSession|null>(null)
  const [error,setError]=useState<string>(),[busy,setBusy]=useState(false),[online,setOnline]=useState(false)
  const [revision,setRevision]=useState(0),[loading,setLoading]=useState(true)
  const [operatorStatus,setOperatorStatus]=useState<OperatorStatus|null>(null)
  const [positionsUpdating,setPositionsUpdating]=useState(false)
  const refresh=()=>setRevision(value=>value+1)
  useEffect(()=>{
    let alive=true,pending=false
    setRows([]);setSession(null);setOperatorStatus(null);setLoading(true)
    async function load(){
      if(pending)return;pending=true
      try{
        const current=await readSession(account)
        if(!alive)return
        setSession(current)
        if(!current){setRows([]);setOperatorStatus(null);return}
        const [data,status]=await Promise.all([requestJson(admin?'/admin/deployments':'/deployments'),admin&&current.operator?requestJson('/admin/status'):null])
        if(alive){setRows(data.deployments);setOnline(data.creatorOnline);setPositionsUpdating(data.positionsUpdating);setOperatorStatus(status);setError(undefined)}
      }catch(cause){if(alive){setError((cause as Error).message);setRows([]);setOperatorStatus(null)}}
      finally{pending=false;if(alive)setLoading(false)}
    }
    void load();const timer=setInterval(()=>void load(),5000)
    window.addEventListener('saffron:vault-updated',refresh);window.addEventListener('saffron:session',refresh)
    return ()=>{alive=false;clearInterval(timer);window.removeEventListener('saffron:vault-updated',refresh);window.removeEventListener('saffron:session',refresh)}
  },[account,admin,revision])
  async function signIn(){if(!account)return;setBusy(true);setError(undefined);try{await ensureSession(account);refresh()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  return {rows,session,error,busy,online,operatorStatus,positionsUpdating,loading,refresh,signIn}
}
