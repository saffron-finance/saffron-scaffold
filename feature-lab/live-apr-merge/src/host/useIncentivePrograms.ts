import { useEffect,useRef,useState } from 'react'
import type { Offer } from '../incentives/model'
import { requestJson } from './transport'

type Catalog = {offers:Offer[];creatorOnline:boolean;readiness?:any;loading:boolean;hasSnapshot:boolean;error?:string}
const cacheKey='saffron.incentive-programs.v2:'+import.meta.env.BASE_URL
const maxAge=300_000
/** Validate the fields used during display. Browser storage is optional and
 * untrusted: malformed nested rows must not crash the returning page. This is
 * NOT admission/transaction validation; cached offers always remain disabled. */
function displayOffer(value:any):value is Offer {
  const token=(item:any)=>item&&typeof item.address==='string'&&typeof item.symbol==='string'&&Number.isInteger(item.decimals)
  return value&&typeof value.id==='string'&&typeof value.pairId==='string'
    &&token(value.token0)&&token(value.token1)&&Number.isFinite(value.apr)&&Number.isFinite(value.days)
    &&typeof value.active==='boolean'&&value.budget&&typeof value.budget.paused==='boolean'
    &&(value.budget.reconciliationRequired===undefined||typeof value.budget.reconciliationRequired==='boolean')
    &&(value.availability===null||typeof value.availability==='string')
    &&(!value.vaultTvl||typeof value.vaultTvl.status==='string'&&(value.vaultTvl.usdRaw===null||typeof value.vaultTvl.usdRaw==='string'&&/^\d+$/.test(value.vaultTvl.usdRaw)))
}
/** Paint a recent origin-local display snapshot on refresh OR a new tab. No
 * wallet, payment, session, or readiness state is persisted here. Browser clear,
 * expiry, malformed data, and blocked storage all use the normal cold path. */
function initialCatalog():Catalog {
  const empty={offers:[],creatorOnline:false,loading:true,hasSnapshot:false}
  try{
    const raw=localStorage.getItem(cacheKey)
    if(!raw||raw.length>262_144)return empty
    const saved=JSON.parse(raw),age=Date.now()-saved?.at
    if(typeof saved?.at==='number'&&age>=0&&age<maxAge&&Array.isArray(saved.offers)
      &&saved.offers.length<=200&&saved.offers.every(displayOffer))return {...empty,offers:saved.offers,hasSnapshot:true}
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
          setState({offers:data.offers,creatorOnline:data.creatorOnline,readiness:data.readiness,loading:false,hasSnapshot:true})
          try{localStorage.setItem(cacheKey,JSON.stringify({offers:data.offers,at:Date.now()}))}catch{/* A storage failure must not hide a good response. */}
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
