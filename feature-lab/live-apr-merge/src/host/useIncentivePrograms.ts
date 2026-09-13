import { useEffect,useRef,useState } from 'react'
import type { Offer } from '../incentives/model'
import { requestJson } from './transport'

/** Visible catalog refreshes at most twice a minute. Focus/pageshow reuse the
 * recent response; explicit configuration events still refresh immediately. */
export function useIncentivePrograms(){
  const [state,setState]=useState<{offers:Offer[];creatorOnline:boolean;readiness?:any;loading:boolean;error?:string}>({offers:[],creatorOnline:false,loading:true})
  const refreshRef=useRef<()=>void>(()=>{})
  const refresh=()=>refreshRef.current()
  useEffect(()=>{
    const controller=new AbortController();let pending=false,last=0
    async function load(force=false){
      if(pending||document.hidden||!force&&Date.now()-last<30_000)return
      pending=true;last=Date.now()
      try{
        const data=await requestJson('/programs',undefined,controller.signal)
        if(!Array.isArray(data.offers))throw new Error('The incentive catalog is unavailable.')
        if(!controller.signal.aborted)setState({offers:data.offers,creatorOnline:data.creatorOnline,readiness:data.readiness,loading:false})
      }catch(error){if(!controller.signal.aborted)setState({offers:[],creatorOnline:false,loading:false,error:(error as Error).message})}finally{pending=false}
    }
    const force=()=>void load(true),resume=()=>void load()
    refreshRef.current=force;void load()
    const timer=setInterval(resume,30_000)
    window.addEventListener('saffron:catalog-updated',force);window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume)
    return()=>{controller.abort();clearInterval(timer);refreshRef.current=()=>{};window.removeEventListener('saffron:catalog-updated',force);window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}
  },[])
  return {...state,refresh}
}
