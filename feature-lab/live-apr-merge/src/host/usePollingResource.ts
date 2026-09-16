import { useCallback,useEffect,useRef,useState } from 'react'

/** One request at a time, with abort on disposal and bounded failure backoff.
 * Keep the last response through outages; consumers disable dependent actions. */
export function usePollingResource<T>(key:string,load:(signal:AbortSignal)=>Promise<T>,events='saffron:vault-updated',enabled=true){
  const [state,setState]=useState<{key:string;data:T|null;error?:string}>({key,data:null})
  const trigger=useRef<()=>void>(()=>{})
  const refresh=useCallback(()=>trigger.current(),[])
  useEffect(()=>{
    // Disabled consumers register no timers/listeners and issue no request.
    if(!enabled){trigger.current=()=>{};return}
    const controller=new AbortController();let pending=false,queued=false,revision=0,failures=0,timer:ReturnType<typeof setTimeout>|undefined
    async function poll(){
      if(pending||controller.signal.aborted)return
      clearTimeout(timer);pending=true;const started=revision
      try{const data=await load(controller.signal);if(!controller.signal.aborted&&started===revision){setState({key,data});failures=0}}
      catch(cause){if(!controller.signal.aborted&&started===revision){failures++;setState(previous=>({key,data:previous.key===key?previous.data:null,error:(cause as Error).message}))}}
      finally{pending=false;if(!controller.signal.aborted){if(queued){queued=false;void poll()}else timer=setTimeout(()=>void poll(),document.hidden?30000:Math.min(30000,5000*2**Math.min(failures,3)))}}
    }
    // A completed mutation invalidates reads that began before it. Coalesce
    // repeated invalidations into one follow-up without overlapping requests.
    const invalidate=()=>{revision++;if(pending)queued=true;else void poll()}
    const foreground=()=>{if(!document.hidden)invalidate()}
    trigger.current=invalidate;void poll()
    const names=events.split(',').filter(Boolean)
    for(const name of names)window.addEventListener(name,foreground)
    window.addEventListener('focus',foreground);window.addEventListener('pageshow',foreground);document.addEventListener('visibilitychange',foreground)
    return()=>{controller.abort();clearTimeout(timer);for(const name of names)window.removeEventListener(name,foreground);window.removeEventListener('focus',foreground);window.removeEventListener('pageshow',foreground);document.removeEventListener('visibilitychange',foreground)}
  },[key,load,events,enabled])
  const current=state.key===key?state:{key,data:null}
  return {...current,refresh,loading:enabled&&!current.data&&!current.error}
}
