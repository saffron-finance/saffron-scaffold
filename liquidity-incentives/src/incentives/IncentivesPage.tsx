import { useEffect,useState } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { HeaderCell,StepTitle,StepSubtitle } from '../host/ui'
import { useDeploymentFlow } from '../host/useDeploymentFlow'
import { useDeployments } from '../host/useDeployments'
import { useOfferPrice } from '../host/useOfferPrice'
import { useIncentivePrograms } from '../host/useIncentivePrograms'
import { compactUsd,type Offer } from './model'
import { ErrorText,FinePrint,Muted,Premium,QuietButton,Row } from './styles'
import { PairHeader } from './PairHeader'
import { TokenIcon } from './TokenIcon'
import robinhoodLogo from './assets/robinhood.svg'
import { IncentiveModal } from './IncentiveModal'
import { MyVaults } from './MyVaults'
import { IncentivesAdmin } from './IncentivesAdmin'

export default function IncentivesPage(props:{account:Address|null;onConnect:()=>void}){
  const [selected,setSelected]=useState<Offer|null>(null)
  return <WalletPage key={props.account??'guest'} {...props} selected={selected} setSelected={setSelected}/>
}
function WalletPage({account,onConnect,selected,setSelected}:{account:Address|null;onConnect:()=>void;selected:Offer|null;setSelected:(offer:Offer|null)=>void}){
  const flow=useDeploymentFlow(account),positions=useDeployments(account),catalog=useIncentivePrograms()
  const [vaultId,setVaultId]=useState<string|null>(null),[resume,setResume]=useState(false)
  const base=import.meta.env.BASE_URL.replace(/\/$/,'')
  const [route,setRoute]=useState(()=>location.pathname.slice(base.length))
  const price=useOfferPrice(flow.quote?null:selected)
  const groups=Array.from(new Set(catalog.offers.map(o=>o.pairId))).map(id=>catalog.offers.filter(o=>o.pairId===id))
  function navigate(path:string){history.pushState(null,'',base+path);setRoute(path);window.dispatchEvent(new Event('saffron:navigation'))}
  useEffect(()=>{const update=()=>setRoute(location.pathname.slice(base.length));window.addEventListener('popstate',update);return()=>window.removeEventListener('popstate',update)},[base])
  function openOffer(offer:Offer){if(flow.saved){setResume(true);return}flow.reset();setSelected(offer);setVaultId(null)}
  function close(){setSelected(null);setVaultId(null);setResume(false);positions.refresh();catalog.refresh()}
  return <Page>
    {route==='/admin'?<IncentivesAdmin account={account} onConnect={onConnect} onBack={()=>navigate('/')}/>:route==='/portfolio/vaults'?<MyVaults account={account} positions={positions} onConnect={onConnect} onBack={()=>navigate('/')} onOpen={setVaultId} onAdmin={()=>navigate('/admin')}/>:<>
      <TitleRow><StepTitle>Liquidity Incentives</StepTitle><QuietButton onClick={()=>navigate('/portfolio/vaults')}>My vaults</QuietButton></TitleRow>
      <Introduction aria-label='About liquidity incentives'><StepSubtitle>Choose a liquidity incentive and create a vault sized to your deposit.</StepSubtitle><StepSubtitle>We fund the premium. Once your vault is ready, deposit your LP assets and claim the incentive here.</StepSubtitle></Introduction>
      {flow.saved&&<Recovery><FinePrint>A creation payment request is saved.</FinePrint><QuietButton onClick={()=>setResume(true)}>Resume deployment</QuietButton></Recovery>}
      {catalog.loading&&<FinePrint role='status'>Loading incentive programs…</FinePrint>}
      {catalog.error&&<ErrorText role='alert'>{catalog.error}</ErrorText>}
      {!catalog.loading&&!catalog.error&&!catalog.offers.length&&<FinePrint>No incentive programs are available right now.</FinePrint>}
      {groups.map(offers=><ProgramGroup key={offers[0].pairId}><PairHeader pair={offers[0]}/><Programs data-incentive-programs aria-label={offers[0].token0.symbol+' / '+offers[0].token1.symbol+' liquidity incentive offers'}>
        <ProgramHeading aria-hidden='true'>{['Yield','APR','Duration','Capacity'].map(label=><ColumnTitle as='span' key={label}>{label}</ColumnTitle>)}</ProgramHeading>
        {offers.map(offer=><ProgramRow key={offer.id} type='button' data-incentive-offer={offer.id} aria-label={'Create '+offer.token0.symbol+' / '+offer.token1.symbol+', '+offer.days+' days'} onClick={()=>openOffer(offer)}>
          <Metric><MobileLabel>Yield</MobileLabel><YieldToken><TokenIcon {...offer.token0} size={48}/><ChainBadge src={robinhoodLogo} alt='Robinhood Chain' width={20} height={20}/></YieldToken></Metric>
          <Metric><MobileLabel>APR</MobileLabel><OfferApr data-incentive-apr>{offer.apr.toLocaleString()}%</OfferApr></Metric>
          <Metric><MobileLabel>Duration</MobileLabel><Value>{offer.days} days</Value></Metric>
          <CapacityCell><MobileLabel>Capacity</MobileLabel><CapacityMeter title={offer.availability??'Available size under the shared campaign budget'}><Value>{offer.eligibleMaximumCents===null?'Unavailable':compactUsd(Number(offer.budget.accounting?.availableCapacityCents??offer.eligibleMaximumCents)/100)}</Value><Muted>{offer.budget.paused?'Paused':offer.eligibleMaximumCents==='0'?'Exhausted':offer.budget.accounting?'campaign capacity remaining':'up to per vault'}</Muted></CapacityMeter></CapacityCell>
          {offer.isNew&&<NewTag>NEW</NewTag>}
        </ProgramRow>)}
      </Programs></ProgramGroup>)}
      <Row><FinePrint>Available size depends on the shared campaign budget and current prices.{!catalog.creatorOnline&&catalog.offers.length?' The deployment worker is currently offline.':''}</FinePrint><QuietButton onClick={catalog.refresh} disabled={catalog.loading}>Refresh offers</QuietButton></Row>
    </>}
    {(selected||vaultId||resume)&&<IncentiveModal offer={selected} account={account} flow={flow} price={price} deploymentId={vaultId} onClose={close} onConnect={onConnect}/>}
  </Page>
}

// Shared grid tracks keep the independent header and button cards aligned.
// Each row is a native button, so Enter/Space and focus work without handlers.
const Page = styled.section`display:flex;flex-direction:column;gap:28px;width:100%;min-width:0;padding-top:24px;`
// A compact rail leaves less room on phones; navigation can move below the title.
const TitleRow = styled(Row)`flex-wrap:wrap;button{white-space:nowrap;flex-shrink:0}`
const Introduction = styled.div`display:flex;flex-direction:column;gap:18px;max-width:860px;`
const Programs = styled.div`display:flex;flex-direction:column;gap:28px;margin-top:8px;`
const ProgramGroup = styled.div`display:flex;flex-direction:column;gap:28px;min-width:0;`
const programColumns = 'minmax(88px,1fr) minmax(110px,1fr) minmax(80px,.8fr) minmax(220px,1.4fr) 56px'
const ProgramHeading = styled.div`
  /* Reduce only the heading gap: offer-to-offer spacing remains 28px. */
  margin-bottom:-24px;background:none;
  display:grid;grid-template-columns:${programColumns};column-gap:24px;align-items:center;padding:4px 32px;
  border:1px solid transparent;border-radius:var(--radius-md);
  @media(max-width:800px){padding:4px 12px;grid-template-columns:.9fr 1.1fr .9fr 1.2fr;column-gap:8px}
`
// Match the introductory body text using the shared, theme-aware gray.
const ColumnTitle = styled(HeaderCell)`min-width:0;padding-left:0;padding-right:0;color:${({ theme }) => theme.colors.text.tertiary};`
const ProgramRow = styled.button`
  display:grid;grid-template-columns:${programColumns};align-items:center;column-gap:24px;
  width:100%;min-height:124px;padding:28px 32px;text-align:left;font:inherit;color:inherit;
  border:1px solid #1d1d1d;border-radius:var(--radius-md);
  /* Quiet gray cards match the approved design in normal and staging builds. */
  background:#0a0a0a;
  /* Restore the gold hover without changing card geometry or the gray surface. */
  cursor:pointer;transition:border-color .16s ease;
  &:hover{border-color:${({ theme }) => theme.colors.accent.gold}}
  &:focus-visible{outline:2px solid ${({ theme }) => theme.colors.accent.gold};outline-offset:4px}
  @media(max-width:800px){padding:24px 12px;grid-template-columns:40px minmax(0,1fr) minmax(0,1fr) 38px;gap:24px 10px}
`
const Metric = styled.span`display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0;font-size:20px;
  @media(max-width:800px){font-size:18px}`
const MobileLabel = styled.span`display:none;@media(max-width:800px){display:block;font-family:${({ theme }) => theme.fonts.mono};font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${({ theme }) => theme.colors.text.label}}`
// Keep the screenshot-sized chain badge anchored to the icon, not the cell.
const YieldToken = styled.span`position:relative;display:inline-flex;flex-shrink:0;@media(max-width:800px){> :first-child{width:40px !important;height:40px !important}}`
const ChainBadge = styled.img`position:absolute;right:-7px;bottom:-5px;border-radius:50%;background:#fff;object-fit:cover;box-shadow:0 0 0 1.5px rgba(0,0,0,.55);`
// Homepage metrics have explicit sizes; secondary capacity text stays unchanged.
const OfferApr = styled(Premium)`
  font-size:28px;font-family:"Funnel Display", serif;font-weight:500 !important;
  background-image:linear-gradient(110deg, rgb(255, 188, 9) 10%, rgb(228, 126, 1) 65%, rgb(250, 63, 6) 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
`
const Value = styled.span`font-size:22px;font-variant-numeric:tabular-nums;`
// A per-request ceiling is not an aggregate funding progress measurement.
const CapacityCell = styled(Metric)`@media(max-width:800px){grid-column:1/-1;grid-row:2}`
const CapacityMeter = styled.span`display:flex;align-items:center;gap:12px;width:100%;white-space:nowrap;`
const NewTag = styled.span`grid-column:5;justify-self:end;padding:7px 10px;border-radius:var(--radius-md);
  background:${({ theme }) => theme.colors.accent.yellow};color:#0f1621;
  font:500 13px ${({ theme }) => theme.fonts.mono};line-height:1;letter-spacing:.02em;
  @media(max-width:800px){grid-column:4;grid-row:1;padding:6px;font-size:11px}`
const Recovery = styled(Row)`padding:12px 14px;border:1px solid transparent;border-radius:var(--radius-md);flex-wrap:wrap;`
