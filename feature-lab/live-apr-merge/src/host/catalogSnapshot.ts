import type { Offer } from '../incentives/model'

export type Catalog = {offers:Offer[];creatorOnline:boolean;readiness?:any;loading:boolean;hasSnapshot:boolean;error?:string}
export const cacheKey='saffron.incentive-programs.v2:'+import.meta.env.BASE_URL
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
export function initialCatalog():Catalog {
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

/** Persist only the display projection, never the whole server object. Unknown
 * future fields (including credentials/capabilities) cannot silently become
 * long-lived browser storage. Cached rows are display-only and stay disabled. */
export function saveCatalogDisplay(offers: Offer[]): void {
  if (!Array.isArray(offers) || offers.length > 200) return
  const token = (value: Offer['token0']) => ({ address:value.address, symbol:value.symbol, decimals:value.decimals })
  const rows = offers.map(value => ({
    id:value.id, pairId:value.pairId, apr:value.apr, days:value.days,
    feeTier:value.feeTier, active:value.active, isNew:value.isNew,
    availability:value.availability, token0:token(value.token0), token1:token(value.token1),
    budget:{paused:value.budget.paused, reconciliationRequired:value.budget.reconciliationRequired},
    vaultTvl:value.vaultTvl ? {status:value.vaultTvl.status, usdRaw:value.vaultTvl.usdRaw} : undefined,
  }))
  if (!rows.every(displayOffer)) return
  const encoded=JSON.stringify({offers:rows,at:Date.now()})
  if(encoded.length<=262_144)localStorage.setItem(cacheKey,encoded)
}
