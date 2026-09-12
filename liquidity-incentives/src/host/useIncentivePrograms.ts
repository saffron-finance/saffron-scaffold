import { useEffect,useState } from 'react'
import type { Offer } from '../incentives/model'
import { requestJson } from './transport'
export function useIncentivePrograms(){
  const [state,setState]=useState<{offers:Offer[];creatorOnline:boolean;readiness?:any;loading:boolean;error?:string}>({offers:[],creatorOnline:false,loading:true})
  const [revision,setRevision]=useState(0)
  const refresh=()=>setRevision(value=>value+1)
  useEffect(()=>{
    const controller=new AbortController();let pending=false
    async function load(){if(pending)return;pending=true;try{
      const data=await requestJson('/programs',undefined,controller.signal)
      if(!Array.isArray(data.offers))throw new Error('The incentive catalog is unavailable.')
      if(!controller.signal.aborted)setState({offers:data.offers,creatorOnline:data.creatorOnline,readiness:data.readiness,loading:false})
    }catch(error){if(!controller.signal.aborted)setState({offers:[],creatorOnline:false,loading:false,error:(error as Error).message})}finally{pending=false}}
    void load();const timer=setInterval(()=>void load(),15_000)
    return ()=>{controller.abort();clearInterval(timer)}
  },[revision])
  useEffect(()=>{
    const resume=()=>{if(!document.hidden)refresh()}
    window.addEventListener('saffron:catalog-updated',refresh);window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume)
    return ()=>{window.removeEventListener('saffron:catalog-updated',refresh);window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}
  },[])
  return {...state,refresh}
}
