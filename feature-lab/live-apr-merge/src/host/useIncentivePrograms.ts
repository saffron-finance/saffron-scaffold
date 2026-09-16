import { useEffect,useRef,useState } from 'react'
import type { Offer } from '../incentives/model'
import { requestJson } from './transport'

type Catalog = {offers:Offer[];creatorOnline:boolean;readiness?:any;loading:boolean;error?:string}
const cacheKey='saffron.incentive-programs.v1:'+import.meta.env.BASE_URL
/** Paint a recent tab-local snapshot immediately; fresh availability still gates
 * interaction. Expired, malformed or blocked storage falls back to skeletons. */
function initialCatalog():Catalog {
  const empty={offers:[],creatorOnline:false,loading:true}
  try{
    const saved=JSON.parse(sessionStorage.getItem(cacheKey)||'null'),age=Date.now()-saved?.at
    if(age>=0&&age<300_000&&Array.isArray(saved?.offers))return {...empty,offers:saved.offers}
  }catch{/* Storage is optional. */}
  return empty
}

/** Visible catalog refreshes at most twice a minute. Focus/pageshow reuse the
 * recent response; explicit configuration events still refresh immediately. */
export function useIncentivePrograms(){
  const [state,setState]=useState<Catalog>(initialCatalog)
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
        if(!controller.signal.aborted){
          setState({offers:data.offers,creatorOnline:data.creatorOnline,readiness:data.readiness,loading:false})
          try{sessionStorage.setItem(cacheKey,JSON.stringify({offers:data.offers,at:Date.now()}))}catch{/* A storage failure must not hide a good response. */}
        }
      }catch(error){if(!controller.signal.aborted)setState(previous=>({...previous,creatorOnline:false,loading:false,error:(error as Error).message}))}finally{pending=false}
    }
    const force=()=>void load(true),resume=()=>void load()
    refreshRef.current=force;void load()
    const timer=setInterval(resume,30_000)
    window.addEventListener('saffron:catalog-updated',force);window.addEventListener('focus',resume);window.addEventListener('pageshow',resume);document.addEventListener('visibilitychange',resume)
    return()=>{controller.abort();clearInterval(timer);refreshRef.current=()=>{};window.removeEventListener('saffron:catalog-updated',force);window.removeEventListener('focus',resume);window.removeEventListener('pageshow',resume);document.removeEventListener('visibilitychange',resume)}
  },[])
  return {...state,refresh}
}
