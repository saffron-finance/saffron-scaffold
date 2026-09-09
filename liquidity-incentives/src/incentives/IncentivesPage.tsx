import { useEffect, useState } from 'react'
import type { Address } from 'viem'
import styled from 'styled-components'
import { HeaderCell, StepTitle, StepSubtitle, CapacityBar, marbleHeaderBackground } from '../host/ui'
import { useRequestFlow } from '../host/useRequestFlow'
import { usePendingRequests } from '../host/usePendingRequests'
import { useOfferPrice } from '../host/useOfferPrice'
import { OFFERS, compactUsd, offerFromRequest, type Offer } from './model'
import { FinePrint, Muted, Premium, QuietButton, Row } from './styles'
import { PairHeader } from './PairHeader'
import cashcatLogo from './assets/cashcat.jpg'
import robinhoodLogo from './assets/robinhood.svg'
import { IncentiveRequestModal } from './IncentiveRequestModal'
import { PendingRequests } from './PendingRequests'

// Presentation metadata uses the offer ID, never the row index or signed terms.
const NEW_OFFER_ID = 'cashcat-eth-1000-3d'

/** Only the LP feature lives here. Wallet transport, prices, request storage
 * and fixed-income primitives enter through host adapters for a narrow merge. */
export default function IncentivesPage({ account, onConnect }: { account: Address | null; onConnect: () => void }) {
  const flow = useRequestFlow(account, onConnect)
  const requests = usePendingRequests(account)
  const [selected, setSelected] = useState<Offer | null>(null)
  const [showPending, setShowPending] = useState(() => window.location.hash === '#requests')
  const activeOffer = flow.pending ? offerFromRequest(flow.pending) : selected
  const price = useOfferPrice(flow.pending ? null : selected)

  // Imported receipts can name an old catalog entry. Render their stored terms,
  // not today's offer, and keep the page-level flow alive when a modal closes.
  useEffect(() => {
    if (flow.pending && selected) setSelected(offerFromRequest(flow.pending))
  }, [flow.pending])
  useEffect(() => {
    const showFromHash = () => { if (window.location.hash === '#requests') setShowPending(true) }
    window.addEventListener('hashchange', showFromHash)
    return () => window.removeEventListener('hashchange', showFromHash)
  }, [])

  function closeRequests() {
    setShowPending(false)
    if (window.location.hash === '#requests') window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }

  async function importReceipt(file: File) {
    const receipt = await flow.importReceipt(file)
    closeRequests()
    setSelected(offerFromRequest(receipt))
  }

  function openOffer(offer: Offer) {
    if (flow.step === 'done') flow.clearFinished()
    setSelected(flow.pending && flow.step !== 'done' ? offerFromRequest(flow.pending) : offer)
  }

  return <Page>
    <TitleRow><StepTitle>Liquidity Incentives</StepTitle><QuietButton id='requests' onClick={() => setShowPending(true)}>My requests{account && requests.rows.length ? ` (${requests.rows.length})` : ''}</QuietButton></TitleRow>
    <Introduction aria-label='About liquidity incentives'>
      <StepSubtitle>Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat.</StepSubtitle>
      <StepSubtitle>Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.</StepSubtitle>
    </Introduction>
    <PairHeader />
    {flow.pending && flow.step !== 'done' && <Recovery><FinePrint>A saved request is ready to resume. No new fee will be sent.</FinePrint>
      <QuietButton onClick={() => setSelected(offerFromRequest(flow.pending!))}>Resume paid request</QuietButton></Recovery>}
    <Programs aria-label='Liquidity incentive offers'>
      <ProgramHeading aria-hidden='true'>
        <ColumnTitle as='span'>Yield token</ColumnTitle>
        <ColumnTitle as='span'>Incentive APR</ColumnTitle>
        <ColumnTitle as='span'>Duration</ColumnTitle>
        <ColumnTitle as='span'>Vault capacity</ColumnTitle>
      </ProgramHeading>
      {OFFERS.map(offer => {
        const isNew = offer.id === NEW_OFFER_ID
        return <ProgramRow key={offer.id} type='button' data-incentive-offer={offer.id}
        aria-label={`Request CASHCAT / ETH, ${offer.days} days`}
        aria-describedby={`${offer.id}-yield ${offer.id}-apr ${offer.id}-capacity${isNew ? ` ${offer.id}-new` : ''}`} onClick={() => openOffer(offer)}>
        <Metric id={`${offer.id}-yield`}><MobileLabel>Yield token</MobileLabel><YieldToken>
          <YieldIcon src={cashcatLogo} alt='CASHCAT' width={48} height={48} />
          <ChainBadge src={robinhoodLogo} alt='Robinhood Chain' width={20} height={20} />
        </YieldToken></Metric>
        <Metric id={`${offer.id}-apr`}><MobileLabel>Incentive APR</MobileLabel><OfferApr>{offer.apr.toLocaleString()}%</OfferApr></Metric>
        <Metric><MobileLabel>Duration</MobileLabel><Value>{offer.days} days</Value></Metric>
        <CapacityCell id={`${offer.id}-capacity`}><MobileLabel>Vault capacity</MobileLabel>
          {/* Proposed offers have no deployed funding balance. Do not invent
              progress from pending requests; those only pay a request fee. */}
          <CapacityMeter title='Proposed capacity, no funded vault yet'><Value>{compactUsd(offer.capacityUsd)}</Value><CapacityTrack filledPercent={0} /><CapacityPercent>0%</CapacityPercent></CapacityMeter>
        </CapacityCell>
        {isNew && <NewTag id={`${offer.id}-new`}>NEW</NewTag>}
      </ProgramRow>})}
    </Programs>
    <FinePrint>Request an LP vault with an upfront premium. Listed terms are proposed incentives, not funded vaults.</FinePrint>
    {selected && activeOffer && <IncentiveRequestModal key={activeOffer.id} offer={activeOffer} account={account}
      flow={flow} price={price} onClose={() => setSelected(null)} />}
    {showPending && <PendingRequests account={account} requests={requests} onImport={importReceipt} onConnect={onConnect} onClose={closeRequests} />}
  </Page>
}

// Shared grid tracks keep the independent header and button cards aligned.
// Each row is a native button, so Enter/Space and focus work without handlers.
const Page = styled.section`display:flex;flex-direction:column;gap:28px;width:100%;min-width:0;padding-top:24px;`
const TitleRow = styled(Row)`button{white-space:nowrap;flex-shrink:0}`
const Introduction = styled.div`display:flex;flex-direction:column;gap:18px;max-width:860px;`
const Programs = styled.div`display:flex;flex-direction:column;gap:28px;margin-top:8px;`
const programColumns = 'minmax(88px,1fr) minmax(110px,1fr) minmax(80px,.8fr) minmax(220px,1.4fr) 56px'
const ProgramHeading = styled.div`
  ${marbleHeaderBackground}
  display:grid;grid-template-columns:${programColumns};column-gap:24px;align-items:center;padding:4px 32px;
  border:1px solid transparent;border-radius:var(--radius-md);
  @media(max-width:800px){padding:4px 12px;grid-template-columns:.9fr 1.1fr .9fr 1.2fr;column-gap:8px}
`
const ColumnTitle = styled(HeaderCell)`min-width:0;padding-left:0;padding-right:0;`
const ProgramRow = styled.button`
  display:grid;grid-template-columns:${programColumns};align-items:center;column-gap:24px;
  width:100%;min-height:124px;padding:28px 32px;text-align:left;font:inherit;color:inherit;
  border:1px solid rgb(42 10 86);border-radius:var(--radius-md);
  /* Approved sunset background applies to every offer in both build modes. */
  background:radial-gradient(75% 95% at 78% 0%, rgb(255 87 0 / 44%), rgb(145 39 181 / 21%) 38%, transparent 66%), #0a0619;
  /* Match beta's featured-token hover without changing the approved 1px width. */
  cursor:pointer;transition:border-color .16s ease;
  &:hover{border-color:${({ theme }) => theme.colors.accent.gold}}
  &:focus-visible{outline:2px solid ${({ theme }) => theme.colors.accent.gold};outline-offset:4px}
  @media(max-width:800px){padding:24px 12px;grid-template-columns:40px minmax(0,1fr) minmax(0,1fr) 38px;gap:24px 10px}
`
const Metric = styled.span`display:flex;flex-direction:column;align-items:flex-start;gap:10px;min-width:0;font-size:20px;
  @media(max-width:800px){font-size:18px}`
const MobileLabel = styled.span`display:none;@media(max-width:800px){display:block;font-family:${({ theme }) => theme.fonts.mono};font-size:9px;letter-spacing:.06em;text-transform:uppercase;color:${({ theme }) => theme.colors.text.label}}`
const YieldIcon = styled.img`display:block;border-radius:50%;object-fit:cover;@media(max-width:800px){width:40px;height:40px}`
// Keep the screenshot-sized chain badge anchored to the icon, not the cell.
const YieldToken = styled.span`position:relative;display:inline-flex;flex-shrink:0;`
const ChainBadge = styled.img`position:absolute;right:-7px;bottom:-5px;border-radius:50%;background:#fff;object-fit:cover;box-shadow:0 0 0 1.5px rgba(0,0,0,.55);`
const OfferApr = styled(Premium)`font-size:21px;`
const Value = styled.span`font-variant-numeric:tabular-nums;`
// Value, upstream hairline and percentage always share one horizontal line.
const CapacityCell = styled(Metric)`@media(max-width:800px){grid-column:1/-1;grid-row:2}`
const CapacityMeter = styled.span`display:flex;align-items:center;gap:12px;width:100%;white-space:nowrap;`
const CapacityPercent = styled(Muted)`display:block;flex:none;font-family:${({ theme }) => theme.fonts.mono};
  font-size:15px;color:${({ theme }) => theme.colors.text.secondary};font-variant-numeric:tabular-nums;
  @media(max-width:800px){font-size:13px}`
const CapacityTrack = styled(CapacityBar)`min-width:30px;`
const NewTag = styled.span`grid-column:5;justify-self:end;padding:7px 10px;border-radius:var(--radius-md);
  background:${({ theme }) => theme.colors.accent.yellow};color:#0f1621;
  font:500 13px ${({ theme }) => theme.fonts.mono};line-height:1;letter-spacing:.02em;
  @media(max-width:800px){grid-column:4;grid-row:1;padding:6px;font-size:11px}`
const Recovery = styled(Row)`padding:12px 14px;border:1px solid transparent;border-radius:var(--radius-md);flex-wrap:wrap;`
