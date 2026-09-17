import { useEffect,useRef,useState } from 'react'
import { requestJson } from './transport'

import {initialCatalog,saveCatalogDisplay,type Catalog} from './catalogSnapshot'

/** Visible catalog refreshes at most twice a minute. Focus/pageshow reuse the
 * recent response; explicit configuration events still refresh immediately. */
export function useIncentivePrograms(){
  const [state,setState]=useState<Catalog>(initialCatalog)
  const refreshRef=useRef<()=>void>(()=>{})
  // A restored document can retain old handlers as well as old pixels. Revoke
  // their authority synchronously on pagehide, before React gets another turn.
  const freshRef=useRef(false)
  const refresh=()=>refreshRef.current()
  useEffect(()=>{
    let controller:AbortController|null=null,last=0,alive=true,suspended=false,queued=false,revision=0
    async function load(force=false){
      if(force){revision++;last=0;freshRef.current=false}
      if(controller){if(force)queued=true;return}
      if(suspended||document.hidden||!force&&Date.now()-last<30_000)return
      const request=new AbortController();controller=request;last=Date.now()
      const started=revision
      try{
        const data=await requestJson('/programs',undefined,request.signal)
        if(!Array.isArray(data.offers))throw new Error('The incentive catalog is unavailable.')
        if(alive&&!request.signal.aborted&&started===revision){
          freshRef.current=true
          setState({offers:data.offers,creatorOnline:data.creatorOnline,readiness:data.readiness,loading:false,hasSnapshot:true})
          try{saveCatalogDisplay(data.offers)}catch{/* A storage failure must not hide a good response. */}
        }
      }catch(error){if(alive&&!request.signal.aborted&&started===revision){freshRef.current=false;setState(previous=>({...previous,creatorOnline:false,loading:false,error:(error as Error).message}))}}
      finally{if(controller===request){controller=null;if(queued&&alive){queued=false;last=0;void load()}}}
    }
    const force=()=>void load(true),resume=()=>void load()
    // Cancel expendable reads before the browser freezes the document. Keep
    // display rows, but never cache enabled transaction controls across Back.
    const suspend=()=>{
      suspended=true;freshRef.current=false;controller?.abort();controller=null;last=0
      setState(previous=>({...previous,loading:true,creatorOnline:false}))
    }
    const restore=(event:PageTransitionEvent)=>{
      // visibilitychange may precede pageshow. Only this event starts the one
      // restored-page refresh, avoiding an immediately aborted duplicate GET.
      suspended=false
      if(event.persisted){freshRef.current=false;setState(previous=>({...previous,loading:true,creatorOnline:false}));force()}else resume()
    }
    refreshRef.current=force;void load()
    const timer=setInterval(resume,30_000)
    window.addEventListener('saffron:catalog-updated',force);window.addEventListener('focus',resume);window.addEventListener('pageshow',restore);window.addEventListener('pagehide',suspend);document.addEventListener('visibilitychange',resume)
    return()=>{alive=false;freshRef.current=false;controller?.abort();clearInterval(timer);refreshRef.current=()=>{};window.removeEventListener('saffron:catalog-updated',force);window.removeEventListener('focus',resume);window.removeEventListener('pageshow',restore);window.removeEventListener('pagehide',suspend);document.removeEventListener('visibilitychange',resume)}
  },[])
  return {...state,refresh,canAct:()=>freshRef.current}
}
