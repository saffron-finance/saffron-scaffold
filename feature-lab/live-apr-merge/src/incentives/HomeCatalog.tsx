import './IncentivesPage.css'
import { useMemo, type MouseEvent, type ReactNode } from 'react'
import { StepTitle, StepSubtitle } from '../host/ui'
import { ErrorText, FinePrint } from './styles'
import { PairHeader, PairDescription } from './PairHeader'
import { TokenIcon } from './TokenIcon'
import { groupOffers, isOfferLive, type Offer } from './model'
import robinhoodLogo from './assets/robinhood.svg'

type OpenOffer=(offer:Offer,target:HTMLElement)=>void
export type DisplayCatalog={offers:Offer[];loading:boolean;hasSnapshot:boolean;error?:string}

/** Canonical display tree shared by React and build-time warm templates.
 * Wallet state, recovery capabilities and transaction handlers stay outside.
 *
 * MAINTENANCE: keep the cached first view and interactive page consistent.
 * CSS/markup changes regenerate through scripts/warm-template.tsx; do not edit
 * generated HTML or introduce a second hand-maintained layout. When changing
 * fields, formatting, grouping, selectors, token icons or conditional states,
 * also review ../merge/bootstrap.ts (row/restoreDisplay/fillTokens), the cache
 * validator in ../host/catalogSnapshot.ts, and the template's variant coverage.
 * Before shipping such changes, compare cached rows with the API held back to
 * the subsequent React view at desktop/phone widths and with saved appearance
 * settings. Text, geometry and states must agree without a font/layout jump;
 * cached controls must remain disabled until fresh availability is confirmed.
 * See ../../docs/LOADING.md for the startup and verification contract.
 */
export function HomeCatalog({catalog,busy=false,onOpen,recovery}: {
  catalog:DisplayCatalog;busy?:boolean;onOpen?:OpenOffer;recovery?:ReactNode;
}) {
  const groups=useMemo(()=>groupOffers(catalog.offers),[catalog.offers])
  return <>
      <div className='saffron-catalog-title-row' data-desktop-home-copy><StepTitle>Liquidity Incentives</StepTitle></div>
      <div className='saffron-catalog-introduction' data-desktop-home-copy aria-label='About liquidity incentives'><StepSubtitle>Choose a liquidity incentive and create a vault sized to your deposit. Each campaign has a fixed duration and target APR. Review your position and premium before paying the campaign’s fixed ETH request fee.</StepSubtitle><StepSubtitle>We fund the premium after your vault is created. Once it is ready, deposit your LP assets and claim your incentive. Your position stays locked for the chosen duration; follow its progress and withdraw at maturity from Portfolio.</StepSubtitle></div>
      <header className='saffron-catalog-mobile-introduction'>
        <h1>Liquidity incentives</h1>
        <p>Create a vault. Deposit LP assets when it is ready. Claim your incentive after it starts.</p>
        <details><summary>How it works</summary>
          <p>Pay the campaign’s fixed ETH request fee. We fund the premium after creation. Your LP is locked for the chosen duration after start.</p>
        </details>
      </header>
      {recovery}
      {catalog.loading&&!catalog.hasSnapshot&&<div className='saffron-catalog-catalog-skeleton' role='status' aria-label='Loading incentive programs' aria-busy='true'><span/>{[0,1].map(row=><div key={row}><i/><i/><i/><i/></div>)}</div>}
      {catalog.error&&<ErrorText role='alert'>{catalog.offers.length>0&&'Showing saved offers. '}{catalog.error}</ErrorText>}
      {!catalog.loading&&!catalog.error&&!catalog.offers.length&&<FinePrint>No incentive programs are available right now.</FinePrint>}
      {groups.map(offers=><OfferGroup key={offers[0].pairId} offers={offers} firstId={catalog.offers[0]?.id} disabled={busy||catalog.loading||Boolean(catalog.error)} onOpen={onOpen}/>)}
  </>
}

/** A single pair group retains the approved desktop/phone geometry. */
export function OfferGroup({offers,firstId,disabled=true,onOpen}: {offers:Offer[];firstId?:string;disabled?:boolean;onOpen?:OpenOffer}) {
  return <div className='saffron-catalog-program-group' data-pool-group><PairHeader pair={offers[0]}/><div className='saffron-catalog-programs' data-incentive-programs aria-label={offers[0].token0.symbol+' / '+offers[0].token1.symbol+' liquidity incentive offers'}>
        <div className='saffron-catalog-program-heading' aria-hidden='true'>{['Yield','APR','Duration','TVL'].map(label=><span className='saffron-catalog-column-title' style={{gridColumn:label.toLowerCase()}} key={label}>{label==='TVL'?'Vault TVL':label}</span>)}</div>
        {offers.map(offer=><OfferRow key={offer.id} offer={offer} isNew={Boolean(offer.isNew&&offer.id===firstId)} disabled={disabled} onOpen={onOpen}/>)}
      </div><PairDescription/></div>
}

/** One row, including NEW/unavailable variants; reused to generate templates.
 * Even a live-looking cached row is disabled until authoritative refresh. */
export function OfferRow({offer,isNew=false,disabled=true,onOpen}: {offer:Offer;isNew?:boolean;disabled?:boolean;onOpen?:OpenOffer}) {
  const live=isOfferLive(offer)
  return <div className='saffron-catalog-offer-card' data-offer-live={live}><button className='saffron-catalog-program-row' type='button' data-incentive-offer={offer.id} data-new-offer={isNew||undefined} aria-label={'Create '+offer.token0.symbol+' / '+offer.token1.symbol+', '+offer.days+' days'} disabled={disabled||!live} onClick={(event:MouseEvent<HTMLButtonElement>)=>void onOpen?.(offer,event.currentTarget)}>
          <span className='saffron-catalog-metric' style={{gridColumn:'yield'}} data-offer-metric='yield'><span className='saffron-catalog-mobile-label'>Yield</span><span className='saffron-catalog-yield-token'><TokenIcon {...offer.token0} size={48}/><img className='saffron-catalog-chain-badge' src={robinhoodLogo} alt='Robinhood Chain' width={20} height={20}/></span></span>
          <span className='saffron-catalog-metric' style={{gridColumn:'apr'}} data-offer-metric='apr'><span className='saffron-catalog-mobile-label'>APR</span><b className='saffron-catalog-offer-apr' data-incentive-apr>{offer.apr.toLocaleString('en-US',{maximumFractionDigits:2})}%</b></span>
          {/* Element Timing records real text paint in both startup paths. */}
          <span className='saffron-catalog-metric' style={{gridColumn:'duration'}} data-offer-metric='duration'><span className='saffron-catalog-mobile-label'>Duration</span><span className='saffron-catalog-value' data-incentive-duration {...{elementtiming:'warm-first-row'}}>{offer.days} days</span></span>
          <span className='saffron-catalog-metric' style={{gridColumn:'tvl'}} data-offer-metric='tvl'><span className='saffron-catalog-mobile-label'>Vault TVL</span><span className='saffron-catalog-value' data-incentive-tvl title={offer.vaultTvl?.status==='available'?'Confirmed LP principal in campaign vaults':'Vault TVL '+(offer.vaultTvl?.status??'unavailable')}>{offer.vaultTvl?.status==='available'&&offer.vaultTvl.usdRaw!==null?'$'+(Number(offer.vaultTvl.usdRaw)/1e18).toLocaleString('en-US',{maximumFractionDigits:2}):'—'}</span></span>
          {/* Only the first visible offer can carry the catalog's NEW label. */}
          {isNew&&<span className='saffron-catalog-new-tag' data-incentive-new>NEW</span>}
          {!(isNew)&&<span className='saffron-catalog-phone-arrow' aria-hidden='true'>↗</span>}
        </button>{!live&&<span className='saffron-catalog-coming-soon' data-incentive-coming-soon>Coming soon...</span>}</div>
}
