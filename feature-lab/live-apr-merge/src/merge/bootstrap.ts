import '../host/Sidebar.css'
import '../incentives/PairHeader.css'
import '../incentives/IncentivesPage.css'
import { initialCatalog } from '../host/catalogSnapshot'
import { appearanceCss, savedAppearance, savedTypography } from '../dev/appearancePreferences'
import { tokenArtwork } from '../incentives/tokenArtwork'
import { groupOffers, isOfferLive, type Offer, type Token } from '../incentives/model'

// MAINTENANCE: follow the consistency checklist above HomeCatalog in
// ../incentives/HomeCatalog.tsx. Changes to these text/attribute mappings must
// match OfferRow, PairHeader and TokenIcon; never turn cached data into authority.

/** Clone build-generated markup, never HTML recovered from browser storage. */
function clone(id:string):DocumentFragment {
  const template=document.getElementById(id)
  if(!(template instanceof HTMLTemplateElement))throw Error('Startup template unavailable')
  return template.content.cloneNode(true) as DocumentFragment
}

/** Replace the template's token placeholders with text and allowlisted images.
 * Shape/style matches TokenIcon; no address/symbol can become markup or a URL. */
function fillTokens(parent:ParentNode,offer:Offer) {
  for(const old of parent.querySelectorAll<HTMLElement>('[data-token-icon]')) {
    const token:Token=old.dataset.tokenIcon==='__WARM_TOKEN0__'?offer.token0:offer.token1
    const size=Number(old.dataset.tokenSize),compact=old.dataset.tokenCompact==='true'
    const src=tokenArtwork(token.symbol,token.address,compact)
    const node=document.createElement(src?'img':'span')
    node.dataset.tokenIcon=token.symbol;node.dataset.tokenSize=String(size)
    if(compact)node.dataset.tokenCompact='true'
    Object.assign(node.style,{width:size+'px',height:size+'px',borderRadius:'50%',flexShrink:'0'})
    if(node instanceof HTMLImageElement){node.src=src!;node.alt=token.symbol;node.width=size;node.height=size;node.style.objectFit='contain'}
    else{node.setAttribute('role','img');node.setAttribute('aria-label',token.symbol);node.textContent=token.symbol.slice(0,3);Object.assign(node.style,{display:'inline-grid',placeItems:'center',background:'#30243e',color:'#fff',fontSize:size/3+'px'})}
    old.replaceWith(node)
  }
}

/** Fill a canonical row variant. Cached appearance is never action authority. */
function row(offer:Offer,isNew:boolean):DocumentFragment {
  const fragment=clone(`warm-row-${isOfferLive(offer)}-${isNew}`)
  const button=fragment.querySelector<HTMLButtonElement>('[data-incentive-offer]')!
  button.dataset.incentiveOffer=offer.id;button.disabled=true
  button.setAttribute('aria-label',`Create ${offer.token0.symbol} / ${offer.token1.symbol}, ${offer.days} days`)
  fragment.querySelector('[data-incentive-apr]')!.textContent=offer.apr.toLocaleString('en-US',{maximumFractionDigits:2})+'%'
  fragment.querySelector('[data-incentive-duration]')!.textContent=offer.days+' days'
  const tvl=fragment.querySelector<HTMLElement>('[data-incentive-tvl]')!
  tvl.title=offer.vaultTvl?.status==='available'?'Confirmed LP principal in campaign vaults':'Vault TVL '+(offer.vaultTvl?.status??'unavailable')
  tvl.textContent=offer.vaultTvl?.status==='available'&&offer.vaultTvl.usdRaw!==null?'$'+(Number(offer.vaultTvl.usdRaw)/1e18).toLocaleString('en-US',{maximumFractionDigits:2}):'—'
  fillTokens(fragment,offer)
  return fragment
}

/** Restore only recent Home display data. Every other route, cleared storage,
 * unavailable template or malformed cache follows the ordinary React path. */
async function restoreDisplay():Promise<boolean> {
  if(location.pathname.replace(/\/+$/,'')!==import.meta.env.BASE_URL.replace(/\/+$/,'')||new URLSearchParams(location.search).has('view'))return false
  const catalog=initialCatalog()
  if(!catalog.hasSnapshot||!document.getElementById('warm-shell'))return false
  const fragment=clone('warm-shell'),page=fragment.querySelector('.saffron-catalog-page')!
  const groups=groupOffers(catalog.offers),firstId=groups[0]?.[0]?.id
  for(const offers of groups){
    const group=clone('warm-group'),first=offers[0],pair=`${first.token0.symbol} / ${first.token1.symbol}`
    group.querySelector('[data-testid="pool-pair-name"]')!.textContent=pair+' '+((first.feeTier??0)/10_000)+'%'
    const phone=group.querySelector('[data-mobile-pair] h2')!
    // React SSR separates adjacent text expressions with comments. Replace the
    // whole text tail, not just its last token, while retaining the icon span.
    phone.replaceChildren(phone.firstElementChild!,document.createTextNode(pair))
    const programs=group.querySelector('[data-incentive-programs]')!
    programs.setAttribute('aria-label',pair+' liquidity incentive offers')
    programs.querySelectorAll('.saffron-catalog-offer-card').forEach(node=>node.remove())
    fillTokens(group,first)
    for(const offer of offers)programs.append(row(offer,Boolean(offer.isNew&&offer.id===firstId)))
    page.append(group)
  }
  if(import.meta.env.VITE_DEV_TWEAKS==='true'){
    const style=fragment.querySelector('style[data-saffron-appearance]')
    if(style)style.textContent=appearanceCss(savedTypography(),savedAppearance())
  }
  // A cached font still needs decoding. The normal preloads start this earlier;
  // cap the optional fast path so a failed font cannot hold up the application.
  const ready=()=>['Funnel Display','Host Grotesk','Roboto Mono'].every(f=>document.fonts.check('16px "'+f+'"'))
  if(document.fonts&&!ready()){
    let timer:number|undefined
    await Promise.race([document.fonts.ready,new Promise(resolve=>{timer=window.setTimeout(resolve,150)})])
    window.clearTimeout(timer)
    if(!ready())return false
  }
  const root=document.getElementById('root')!
  // Snapshot controls have no handlers yet. Native disabled buttons also stay
  // safe if framework startup fails; inert excludes incomplete keyboard paths.
  fragment.querySelectorAll('button').forEach(button=>{button.disabled=true})
  root.inert=true;root.dataset.warmDisplay='true';root.replaceChildren(fragment)
  performance.mark('saffron:warm-display')
  return true
}

/** Yield one actual rendering opportunity before evaluating the main bundle.
 * Cold visits do not wait. No API response, wallet or session is cached here. */
async function start(){
  let restored=false
  try{restored=await restoreDisplay()}catch{/* Optional display optimization only. */}
  if(restored&&!document.hidden)await new Promise<void>(resolve=>{
    let first=0,second=0
    const finish=()=>{window.clearTimeout(timer);cancelAnimationFrame(first);cancelAnimationFrame(second);resolve()}
    // Background tabs may pause animation frames indefinitely. They should
    // still initialize recovery and be ready when selected; never gate startup
    // on a paint callback when hidden or when the compositor stops responding.
    const timer=window.setTimeout(finish,100)
    first=requestAnimationFrame(()=>{second=requestAnimationFrame(finish)})
  })
  try{await import('./main')}
  catch{
    const root=document.getElementById('root')!
    root.inert=false
    const message=document.createElement('p');message.setAttribute('role','alert')
    message.style.cssText='color:#eee;padding:16px;font:14px sans-serif'
    message.textContent='The application could not start. Your saved requests are unchanged. '
    const retry=document.createElement('button');retry.textContent='Reload';retry.onclick=()=>location.reload()
    message.append(retry);root.prepend(message)
  }
}
void start()
