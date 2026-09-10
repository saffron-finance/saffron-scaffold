import { useEffect,useState } from 'react'
import type { Address } from 'viem'
import type { Deployment } from '../incentives/model'
import { readSession,ensureSession,requestJson,type WalletSession } from './transport'

export function useDeployments(account:Address|null,admin=false){
  const [rows,setRows]=useState<Deployment[]>([]),[session,setSession]=useState<WalletSession|null>(null)
  const [error,setError]=useState<string>(),[busy,setBusy]=useState(false),[online,setOnline]=useState(false)
  const [revision,setRevision]=useState(0),[loading,setLoading]=useState(true)
  const refresh=()=>setRevision(value=>value+1)
  useEffect(()=>{
    let alive=true,pending=false
    setRows([]);setSession(null);setLoading(true)
    async function load(){
      if(pending)return;pending=true
      try{
        const current=await readSession(account)
        if(!alive)return
        setSession(current)
        if(!current){setRows([]);return}
        const data=await requestJson(admin?'/admin/deployments':'/deployments')
        if(alive){setRows(data.deployments);setOnline(data.creatorOnline);setError(undefined)}
      }catch(cause){if(alive){setError((cause as Error).message);setRows([])}}
      finally{pending=false;if(alive)setLoading(false)}
    }
    void load();const timer=setInterval(()=>void load(),5000)
    window.addEventListener('saffron:vault-updated',refresh);window.addEventListener('saffron:session',refresh)
    return ()=>{alive=false;clearInterval(timer);window.removeEventListener('saffron:vault-updated',refresh);window.removeEventListener('saffron:session',refresh)}
  },[account,admin,revision])
  async function signIn(){if(!account)return;setBusy(true);setError(undefined);try{await ensureSession(account);refresh()}catch(cause){setError((cause as Error).message)}finally{setBusy(false)}}
  return {rows,session,error,busy,online,loading,refresh,signIn}
}
