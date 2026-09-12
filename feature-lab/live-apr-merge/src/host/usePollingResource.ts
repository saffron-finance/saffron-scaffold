import { useCallback,useEffect,useRef,useState } from 'react'

/** One request at a time, with abort on disposal and bounded failure backoff.
 * Keep the last response through outages; consumers disable dependent actions. */
export function usePollingResource<T>(key:string,load:(signal:AbortSignal)=>Promise<T>,events='saffron:vault-updated'){
  const [state,setState]=useState<{key:string;data:T|null;error?:string}>({key,data:null})
  const trigger=useRef<()=>void>(()=>{})
  const refresh=useCallback(()=>trigger.current(),[])
  useEffect(()=>{
    const controller=new AbortController();let pending=false,failures=0,timer:ReturnType<typeof setTimeout>|undefined
    async function poll(){
      if(pending||controller.signal.aborted)return
      clearTimeout(timer);pending=true
      try{const data=await load(controller.signal);if(!controller.signal.aborted){setState({key,data});failures=0}}
      catch(cause){if(!controller.signal.aborted){failures++;setState(previous=>({key,data:previous.key===key?previous.data:null,error:(cause as Error).message}))}}
      finally{pending=false;if(!controller.signal.aborted)timer=setTimeout(()=>void poll(),document.hidden?30000:Math.min(30000,5000*2**Math.min(failures,3)))}
    }
    const foreground=()=>{if(!document.hidden)void poll()}
    trigger.current=()=>void poll();void poll()
    const names=events.split(',').filter(Boolean)
    for(const name of names)window.addEventListener(name,foreground)
    window.addEventListener('focus',foreground);window.addEventListener('pageshow',foreground);document.addEventListener('visibilitychange',foreground)
    return()=>{controller.abort();clearTimeout(timer);for(const name of names)window.removeEventListener(name,foreground);window.removeEventListener('focus',foreground);window.removeEventListener('pageshow',foreground);document.removeEventListener('visibilitychange',foreground)}
  },[key,load,events])
  const current=state.key===key?state:{key,data:null}
  return {...current,refresh,loading:!current.data&&!current.error}
}
