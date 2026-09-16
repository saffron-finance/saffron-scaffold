import { useRef,useState,type MouseEvent } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import type { Address } from 'viem'
import styled, { css } from 'styled-components'
import { mobileHomeMaxWidth } from '../host/MobileHomeNavigation'
import { HeaderCell,StepTitle,StepSubtitle } from '../host/ui'
import { aprTextPaint } from '../host/aprTextStyle'
import { rowSurface } from '../host/rowSurface'
import { useDeploymentFlow } from '../host/useDeploymentFlow'
import { useDeployments } from '../host/useDeployments'
import { useOfferPrice } from '../host/useOfferPrice'
import { useIncentivePrograms } from '../host/useIncentivePrograms'
import { isOfferLive,type Offer } from './model'
import { ErrorText,FinePrint,Muted,Premium,QuietButton,Row } from './styles'
import { PairHeader,PairDescription } from './PairHeader'
import { TokenIcon } from './TokenIcon'
import robinhoodLogo from './assets/robinhood.svg'
import { IncentiveModal } from './IncentiveModal'
import { MyVaults } from './MyVaults'
import { ProgramAdmin } from './ProgramAdmin'
import { OperatorStatus } from './OperatorStatus'
import { JourneyGuide } from './JourneyGuide'
import { IncentivesAdmin } from './IncentivesAdmin'

export default function IncentivesPage(props:{account:Address|null;onConnect:()=>void}){
  const [selected,setSelected]=useState<Offer|null>(null)
  return <WalletPage key={props.account??'guest'} {...props} selected={selected} setSelected={setSelected}/>
}
function WalletPage({account,onConnect,selected,setSelected}:{account:Address|null;onConnect:()=>void;selected:Offer|null;setSelected:(offer:Offer|null)=>void}){
  const flow=useDeploymentFlow(account),positions=useDeployments(account),catalog=useIncentivePrograms()
  const [vaultId,setVaultId]=useState<string|null>(null),[resume,setResume]=useState(false),[openPosition,setOpenPosition]=useState(false)
  // The shared router owns paths; the feature keeps its existing flow state.
  const route=useLocation().pathname.replace(/\/+$/,'')||'/'
  const navigate=useNavigate()
  // Keep the cached amount preview available during background quote cleanup.
  // Its own shared cache/timer bounds reads; Back never waits for a fresh RPC.
  const price=useOfferPrice(flow.quote?null:selected)
  const groups=Array.from(new Set(catalog.offers.map(o=>o.pairId))).map(id=>catalog.offers.filter(o=>o.pairId===id))
  // Preserve the opener across asynchronous checkout selection and disabled paint.
  const opener=useRef<HTMLElement|null>(null),opening=useRef(false)
  async function openOffer(offer:Offer,target:HTMLElement){
    // Native disabled controls handle pointer/keyboard input; this also guards
    // against a direct handler call while the catalog says the offer is not live.
    if(opening.current||flow.busy||!isOfferLive(offer))return
    opening.current=true
    try{
    opener.current=target
    if(flow.draft?.programId===offer.id||flow.saved&&!flow.saved.sent&&flow.saved.quote.programId===offer.id)flow.restore()
    else{
      if((flow.draft||flow.saved&&!flow.saved.sent)&&!await flow.reset())return
      if(!await flow.startNew())return
    }
    setSelected(offer);setVaultId(null);setResume(false);setOpenPosition(false)
    }finally{opening.current=false}
  }
  function close(){const target=opener.current;opener.current=null;requestAnimationFrame(()=>{if(target?.isConnected)target.focus()});setSelected(null);setVaultId(null);setResume(false);positions.refresh();catalog.refresh()}
  return <Page $home={route==='/'}>
    {route==='/status'?<OperatorStatus account={account} onConnect={onConnect} onNavigate={navigate}/>:route==='/journey'?<JourneyGuide onNavigate={navigate}/>:route==='/campaigns'?<><TitleRow><StepTitle>Campaigns</StepTitle><QuietButton onClick={()=>navigate('/')}>Home</QuietButton></TitleRow><ProgramAdmin autoLoad account={account} onConnect={onConnect}/></>:route==='/admin'?<IncentivesAdmin account={account} onConnect={onConnect} onNavigate={navigate} onBack={()=>navigate('/')} checkoutRecovery={flow.draft&&<Recovery><FinePrint>An unpaid checkout review is saved.</FinePrint><QuietButton disabled={!catalog.offers.some(o=>o.id===flow.draft?.programId)} onClick={()=>{const offer=catalog.offers.find(o=>o.id===flow.draft?.programId);if(offer){flow.restore();setSelected(offer);setVaultId(null);setResume(false);setOpenPosition(false)}}}>Resume checkout</QuietButton><QuietButton disabled={flow.busy} onClick={()=>void flow.reset()}>Discard unpaid checkout</QuietButton></Recovery>}/>:route==='/portfolio/vaults'?<MyVaults account={account} positions={positions} onConnect={onConnect} onBack={()=>navigate('/')} onOpen={(id,position=false)=>{setVaultId(id);setOpenPosition(position)}} payments={flow.records.filter(p=>p.sent&&!p.deploymentId)} onResumePayment={async(id)=>{await flow.resumePayment(id);setSelected(null);setVaultId(null);setResume(true)}} onAdmin={()=>navigate('/admin')}/>:<>
      <TitleRow data-desktop-home-copy><StepTitle>Liquidity Incentives</StepTitle></TitleRow>
      <Introduction data-desktop-home-copy aria-label='About liquidity incentives'><StepSubtitle>Choose a liquidity incentive and create a vault sized to your deposit. Each campaign has a fixed duration and target APR. Review your position and premium before paying the campaign’s fixed ETH request fee.</StepSubtitle><StepSubtitle>We fund the premium after your vault is created. Once it is ready, deposit your LP assets and claim your incentive. Your position stays locked for the chosen duration; follow its progress and withdraw at maturity from Portfolio.</StepSubtitle></Introduction>
      <MobileIntroduction>
        <h1>Liquidity incentives</h1>
        <p>Create a vault. Deposit LP assets when it is ready. Claim your incentive after it starts.</p>
        <details><summary>How it works</summary>
          <p>Pay the campaign’s fixed ETH request fee. We fund the premium after creation. Your LP is locked for the chosen duration after start.</p>
        </details>
      </MobileIntroduction>
      {flow.saved?.sent&&<Recovery><FinePrint>A creation payment request is saved.</FinePrint><QuietButton onClick={()=>setResume(true)}>Resume deployment</QuietButton></Recovery>}
      {catalog.loading&&<FinePrint role='status'>Loading incentive programs…</FinePrint>}
      {catalog.error&&<ErrorText role='alert'>{catalog.error}</ErrorText>}
      {!catalog.loading&&!catalog.error&&!catalog.offers.length&&<FinePrint>No incentive programs are available right now.</FinePrint>}
      {groups.map(offers=><ProgramGroup data-pool-group key={offers[0].pairId}><PairHeader pair={offers[0]}/><Programs data-incentive-programs aria-label={offers[0].token0.symbol+' / '+offers[0].token1.symbol+' liquidity incentive offers'}>
        <ProgramHeading aria-hidden='true'>{['Yield','APR','Duration','TVL'].map(label=><ColumnTitle as='span' $column={label.toLowerCase()} key={label}>{label==='TVL'?'Vault TVL':label}</ColumnTitle>)}</ProgramHeading>
        {offers.map(offer=><OfferCard key={offer.id} data-offer-live={isOfferLive(offer)}><ProgramRow type='button' data-incentive-offer={offer.id} data-new-offer={offer.isNew&&offer.id===catalog.offers[0]?.id||undefined} aria-label={'Create '+offer.token0.symbol+' / '+offer.token1.symbol+', '+offer.days+' days'} disabled={flow.busy||!isOfferLive(offer)} onClick={(event:MouseEvent<HTMLButtonElement>)=>void openOffer(offer,event.currentTarget)}>
          <Metric $column='yield' data-offer-metric='yield'><MobileLabel>Yield</MobileLabel><YieldToken><TokenIcon {...offer.token0} size={48}/><ChainBadge src={robinhoodLogo} alt='Robinhood Chain' width={20} height={20}/></YieldToken></Metric>
          <Metric $column='apr' data-offer-metric='apr'><MobileLabel>APR</MobileLabel><OfferApr data-incentive-apr>{offer.apr.toLocaleString('en-US',{maximumFractionDigits:2})}%</OfferApr></Metric>
          <Metric $column='duration' data-offer-metric='duration'><MobileLabel>Duration</MobileLabel><Value data-incentive-duration>{offer.days} days</Value></Metric>
          <Metric $column='tvl' data-offer-metric='tvl'><MobileLabel>Vault TVL</MobileLabel><Value data-incentive-tvl title={offer.vaultTvl?.status==='available'?'Confirmed LP principal in campaign vaults':'Vault TVL '+(offer.vaultTvl?.status??'unavailable')}>{offer.vaultTvl?.status==='available'&&offer.vaultTvl.usdRaw!==null?'$'+(Number(offer.vaultTvl.usdRaw)/1e18).toLocaleString('en-US',{maximumFractionDigits:2}):'—'}</Value></Metric>
          {/* Only the first visible offer can carry the catalog's NEW label. */}
          {offer.isNew&&offer.id===catalog.offers[0]?.id&&<NewTag data-incentive-new>NEW</NewTag>}
          {!(offer.isNew&&offer.id===catalog.offers[0]?.id)&&<PhoneArrow aria-hidden='true'>↗</PhoneArrow>}
        </ProgramRow>{!isOfferLive(offer)&&<ComingSoon data-incentive-coming-soon>Coming soon...</ComingSoon>}</OfferCard>)}
      </Programs><PairDescription/></ProgramGroup>)}
    </>}
    {(selected||vaultId||resume)&&<IncentiveModal offer={selected} account={account} flow={flow} price={price} deploymentId={vaultId} openPosition={openPosition} onClose={close} onConnect={onConnect}/>}
  </Page>
}

const Page = styled.section<{$home:boolean}>`display:flex;flex-direction:column;gap:28px;width:100%;min-width:0;
  ${p=>p.$home&&css`@media(max-width:${mobileHomeMaxWidth}px){gap:0;font-family:"Funnel Display",sans-serif;line-height:1.45;color:#f2f0ea;[data-desktop-home-copy]{display:none;}}`}`
/** Short mobile copy comes from the approved HTML, with detailed economics and
 * a native disclosure. Saved-payment warnings remain outside it. */
const MobileIntroduction = styled.header`
  display:none;
  @media(max-width:${mobileHomeMaxWidth}px){
    display:block;margin-bottom:20px;
    h1{margin:0;font:500 28px/1.15 "Funnel Display",sans-serif;letter-spacing:-.035em;}
    p{margin:8px 0 0;font-size:14px;color:#a09ca5;max-width:30em;}
    details{margin-top:8px;color:#a09ca5;font-size:12px;}
    summary{min-height:32px;padding:6px 0;cursor:pointer;touch-action:manipulation;}
    summary:focus-visible{outline:2px solid #d286ff;outline-offset:2px;}
    details p{font-size:12px;}details button{min-height:44px;margin-top:8px;}
  }
`
// A compact rail leaves less room on phones; navigation can move below the title.
const TitleRow = styled(Row)`flex-wrap:wrap;button{white-space:nowrap;flex-shrink:0}`
const Introduction = styled.div`display:flex;flex-direction:column;gap:18px;max-width:860px;`
const Programs = styled.div`display:flex;flex-direction:column;gap:28px;margin-top:8px;@media(max-width:${mobileHomeMaxWidth}px){gap:10px;margin-top:0;}`
const ProgramGroup = styled.div`display:flex;flex-direction:column;gap:28px;min-width:0;border-bottom:1px solid #131313;padding-bottom:24px;@media(max-width:${mobileHomeMaxWidth}px){gap:10px;&+&{margin-top:24px;}}`
// TVL uses the same Value typography as Duration, not capacity or APR styling.
const dataColumns = '[yield] minmax(92px,1fr) [apr] minmax(92px,1fr) [duration] minmax(92px,1fr) [tvl] minmax(116px,1fr)'
const programColumns = `var(--incentive-leading-badge,) ${dataColumns} var(--incentive-trailing-badge,[new] 56px)`
const mobileColumns = 'var(--incentive-mobile-columns,[yield] 40px [apr] minmax(0,1fr) [duration] minmax(0,1fr) [tvl] minmax(0,1fr) [new] 38px)'
// Shared phone tracks and padding keep headings aligned with every offer row.
const phoneColumns = '[yield] 44px [apr] minmax(0,1.15fr) [duration] minmax(0,1fr) [tvl] minmax(0,1fr)'
const ProgramHeading = styled.div`
  /* Reduce only the heading gap: offer-to-offer spacing remains 28px. */
  margin-bottom:-24px;background:none;
  display:grid;grid-template-columns:${programColumns};column-gap:24px;align-items:center;padding:4px 32px;
  border:1px solid transparent;border-radius:var(--radius-md);
  @media(max-width:800px){display:none}
  @media(max-width:${mobileHomeMaxWidth}px){
    display:grid;grid-template-columns:${phoneColumns};column-gap:24px;
    margin:0;padding:0 14px;
    >span{font:400 11px/1.45 "Funnel Display",sans-serif;padding:0;letter-spacing:.04em;color:#a09ca5;white-space:nowrap;}
  }
  @media(max-width:345px){padding-left:12px;padding-right:12px;>span{font-size:10px;letter-spacing:.02em;}}
`
// Match the introductory body text using the shared, theme-aware gray.
const ColumnTitle = styled(HeaderCell)<{$column:string}>`grid-column:${p=>p.$column};min-width:0;padding-left:0;padding-right:0;color:${({ theme }) => theme.colors.text.tertiary};`
// Blur only the offer surface, leaving the overlaid notice sharp and opaque.
// Pointer events pass through to the natively disabled button, never an action.
const OfferCard=styled.div`
  position:relative;min-width:0;
  &[data-offer-live='false']>button{opacity:.45;filter:blur(2px);}
`
const ComingSoon=styled.span`
  position:absolute;left:50%;top:50%;z-index:1;pointer-events:none;
  transform:translate(-50%,-50%) rotate(var(--incentive-coming-soon-angle,-7deg));
  padding:8px 20px;border-radius:4px;background:#12d112;color:#fff;
  font:500 18px/1.2 "Funnel Display",sans-serif;white-space:nowrap;
  @media(max-width:${mobileHomeMaxWidth}px){font-size:15px;padding:6px 14px;}
`
const ProgramRow = styled.button`
  display:grid;grid-template-columns:${programColumns};align-items:center;column-gap:24px;
  width:100%;min-height:124px;padding:28px 32px;text-align:left;font:inherit;color:inherit;
  ${rowSurface}
  cursor:pointer;
  &:disabled{cursor:not-allowed;}
  &:disabled:hover{border-color:#1d1d1d;}
  /* Use media rules supported by the pinned styled-components version.
     Named public metrics and the NEW badge retain their mobile positions. */
  @media(max-width:800px){padding:24px 12px;grid-template-columns:${mobileColumns};gap:24px 10px}
  @media(max-width:480px){
    > :nth-child(2){grid-column:apr / span 3;grid-row:1;}
    > :nth-child(3){grid-column:apr / span 3;grid-row:2;}
    > :nth-child(4){grid-column:apr / span 3;grid-row:3;}
  }
  /* Reuse the same offer button and click handler. Only its phone geometry
     changes; desktop columns and saved desktop badge preferences stay intact. */
  @media(max-width:${mobileHomeMaxWidth}px){
    position:relative;grid-template-columns:${phoneColumns};gap:10px 24px;
    min-height:76px;padding:14px;border:1px solid #262329;border-radius:10px;touch-action:manipulation;
    /* Keep the yield token and its chain badge under the shared Yield heading. */
    [data-offer-metric='yield']{grid-column:yield;grid-row:1;gap:0;}
    [data-offer-metric='apr']{grid-column:apr;grid-row:1;gap:0;}
    [data-offer-metric='apr'] > :first-child{display:none;}
    [data-offer-metric='duration']{grid-column:duration;grid-row:1;gap:0;}
    [data-offer-metric='tvl']{grid-column:tvl;grid-row:1;gap:0;}
    [data-incentive-tvl]{white-space:normal;overflow-wrap:anywhere;}
    &:focus-visible{outline-color:#d286ff;outline-offset:3px;}
    &:disabled{opacity:.45;cursor:not-allowed;}
    &:disabled:hover{border-color:#262329;}
  }
  @media(max-width:345px){padding:12px;}
`
const Metric = styled.span<{$column?:string}>`grid-column:${p=>p.$column??'auto'};display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0;font-size:20px;
  @media(max-width:800px){font-size:18px}`
const MobileLabel = styled.span`display:none;@media(max-width:800px){display:block;font-family:${({ theme }) => theme.fonts.mono};font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${({ theme }) => theme.colors.text.label}}@media(max-width:${mobileHomeMaxWidth}px){display:none;}`
const PhoneArrow = styled.span`display:none;@media(max-width:${mobileHomeMaxWidth}px){display:block;position:absolute;right:14px;top:14px;color:#777;font-size:19px;}`
// Keep the screenshot-sized chain badge anchored to the icon, not the cell.
const YieldToken = styled.span`position:relative;display:inline-flex;flex-shrink:0;@media(max-width:800px){> :first-child{width:40px !important;height:40px !important}}`
const ChainBadge = styled.img`position:absolute;right:-7px;bottom:-5px;border-radius:50%;background:#fff;object-fit:cover;box-shadow:0 0 0 1.5px rgba(0,0,0,.55);`
// Homepage metrics have explicit sizes; shared APR paint remains unchanged.
const OfferApr = styled(Premium)`
  font-size:28px;font-family:"Funnel Display", serif;font-weight:500 !important;
  ${aprTextPaint}
  @media(max-width:480px){font-size:clamp(20px,6.5vw,28px)}
  @media(max-width:${mobileHomeMaxWidth}px){&&{font-size:clamp(20px,6.2vw,27px);line-height:1.1;letter-spacing:-.03em;color:#ffbc09;background-image:none !important;animation:none !important;filter:none !important;-webkit-text-fill-color:#ffbc09;}}
`
const Value = styled.span`font-size:22px;white-space:nowrap;font-variant-numeric:tabular-nums;@media(max-width:${mobileHomeMaxWidth}px){font-size:clamp(15px,4.6vw,20px);font-weight:400;line-height:1.3;font-variant-numeric:normal;}`
const NewTag = styled.span`grid-column:new;grid-row:1;justify-self:var(--incentive-badge-align,end);padding:7px 10px;border-radius:var(--radius-md);
  background:linear-gradient(110deg,#ffbc09 10%,#e47e01 65%,#fa3f06 100%);color:#0f1621;
  font:500 13px ${({ theme }) => theme.fonts.mono};line-height:1;letter-spacing:.02em;
  @media(max-width:800px){padding:6px;font-size:11px}
  /* Mobile uses all four data columns; NEW remains a desktop/tablet detail. */
  @media(max-width:${mobileHomeMaxWidth}px){&&{display:none;}}`
const Recovery = styled(Row)`padding:12px 14px;border:1px solid transparent;border-radius:var(--radius-md);flex-wrap:wrap;`
