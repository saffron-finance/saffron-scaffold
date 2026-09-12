import { useCallback,useEffect,useId,useRef,useState } from 'react'
import CurrencyInput from 'react-currency-input-field'
import { formatUnits,type Address } from 'viem'
import styled,{css,createGlobalStyle} from 'styled-components'
import { FormFieldGroup,FormInput,FormLabel,Modal,ModalTitle,InteractiveEmblem } from '../host/ui'
import { aprTextPaint } from '../host/aprTextStyle'
import { sidebarDefaults, sidebarSelectedSurface, sidebarVariables } from '../host/sidebarTheme'
import type { useDeploymentFlow } from '../host/useDeploymentFlow'
import type { useOfferPrice } from '../host/useOfferPrice'
import { tokenAmount,usd,type Offer } from './model'
import { amountsForLiquidity } from '../../shared/liquidity-math.mjs'
import { campaignPremiumCents } from '../../shared/campaign.mjs'
import { Action,Disclosure,ErrorText,FinePrint,Label,Muted,Premium,QuietButton,Row,Stack,Token } from './styles'
import { TokenIcon } from './TokenIcon'
import { VaultReview } from './VaultReview'
import { DeploymentWaiting } from './DeploymentWaiting'
import { DepositTooltip } from './DepositTooltip'

export function IncentiveModal({offer,account,flow,price,deploymentId,openPosition=false,onClose,onConnect}:{offer:Offer|null;account:Address|null;flow:ReturnType<typeof useDeploymentFlow>;price:ReturnType<typeof useOfferPrice>;deploymentId?:string|null;openPosition?:boolean;onClose:()=>void;onConnect:()=>void;preview?:boolean}){
  const [deposit,setDeposit]=useState(flow.draft?.amountUsd??'100'),[inverted,setInverted]=useState(false),[nativeBusy,setNativeBusy]=useState(false),[lpDetailsOpen,setLpDetailsOpen]=useState(false)
  const id=deploymentId??flow.deployment?.id,reviewed=flow.quote
  const [position,setPosition]=useState(openPosition)
  useEffect(()=>setPosition(openPosition),[openPosition,id])
  const second=Boolean(id||reviewed),busy=flow.busy||nativeBusy
  const titleId=useId(),rangeId=useId(),tokensId=useId(),titleRef=useRef<HTMLDivElement|null>(null)
  const attachTitle=useCallback((node:HTMLDivElement|null)=>{titleRef.current=node;const dialog=node?.closest('[role="dialog"]');dialog?.setAttribute('aria-labelledby',titleId);dialog?.setAttribute('data-incentive-modal','')},[titleId])
  const focusedDeposit=useRef<HTMLInputElement|null>(null)
  const attachDeposit=useCallback((node:HTMLInputElement|null)=>{
    // The formatter reattaches its ref on updates. Focus only a newly mounted
    // field, after the modal has recorded the control that opened it.
    if(node&&node!==focusedDeposit.current){
      focusedDeposit.current=node
      queueMicrotask(()=>{if(node.isConnected)node.focus({preventScroll:true})})
    }
  },[])
  useEffect(()=>{if(second)titleRef.current?.focus()},[second,id])
  const amount=Number(deposit)
  const valid=!!offer&&Number.isFinite(amount)&&amount>0&&!offer.availability&&Boolean(price.value)&&!price.loading
  const tokenUsd=price.value?price.value.quotePerToken*price.value.quoteUsd:0
  // Use campaign-cent rounding on both screens; never relabel the LP principal
  // or the $2 fee as the incentive. The accepted plan owns the reviewed amount.
  const principalCents=Number.isFinite(amount)&&amount>0?Math.round(amount*100):0
  const reward=offer?.budget.campaign&&Number.isSafeInteger(principalCents)
    ?Number(campaignPremiumCents(offer.budget.campaign,String(principalCents)))/100
    :offer&&Number.isFinite(amount)?Math.max(0,amount)*offer.apr/100*offer.days/365:0
  const claimUsd=reviewed?Number(reviewed.plan.premiumCents)/100:reward
  // The review title highlights the reward in green; the primary action stays white.
  const claimLabel=<>Claim <ClaimAmount data-claim-amount>{usd(claimUsd)}</ClaimAmount></>
  const depositTokens=reviewed?[reviewed.plan.token0,reviewed.plan.token1]:offer?[offer.token0,offer.token1]:null
  const pair=offer?offer.token0.symbol+' / '+offer.token1.symbol:''
  // Keep the approved review layout. The preview has no payment deadline;
  // the live hook independently enforces the API's exact fee and quote expiry.
  // Back creates a fresh quote without discarding a submitted payment record.
  const raw=reviewed?amountsForLiquidity(reviewed.plan.liquidity,reviewed.plan.sqrtPrice,reviewed.plan.minTick,reviewed.plan.maxTick):null
  const close=()=>{if(!busy)onClose()}
  return <Modal isOpen onRequestClose={close} shouldCloseOnOverlayClick={!busy} contentStyle={{padding:'10px 28px 26px 28px'}}>
    <ModalButtonHover/>
    <Close aria-label='Close incentive vault' disabled={busy} onClick={close}>×</Close>
    {reviewed&&!id&&!flow.saved?.sent&&<BackButton disabled={busy} onClick={flow.reset}>← Back</BackButton>}
    <Header $hasLogo={!second}><RequestTitle id={titleId} role='heading' aria-level={2} tabIndex={-1} ref={attachTitle}>
      {second?(id?'Your incentive vault':claimLabel):<TitleContent><Token><PairIcons><TokenIcon symbol={offer!.token0.symbol} size={24}/><TokenIcon symbol={offer!.token1.symbol} size={24}/></PairIcons>{pair}</Token>
        <TitleStats><TitleApr data-incentive-apr>{offer!.apr.toLocaleString()}% APR</TitleApr><TitleDays>{offer!.days} days</TitleDays></TitleStats></TitleContent>}
    </RequestTitle>{!second&&<InteractiveEmblem/>}</Header>
    <ModalContent $amountPage={!second}>
      {!id&&depositTokens&&<DepositReward aria-label='Deposit and incentive'><PairIcons aria-hidden='true'><TokenIcon {...depositTokens[0]} size={24}/><TokenIcon {...depositTokens[1]} size={24}/></PairIcons><span>Deposit {depositTokens[0].symbol}/{depositTokens[1].symbol}, get {usd(claimUsd)}</span></DepositReward>}
      {id&&account?<DeploymentWaiting key={account+id} account={account} id={id} position={position} onPosition={()=>setPosition(true)} onBusy={setNativeBusy}/>:reviewed?<>
        <VaultReview label='Deployment summary' bullets={<>
          <li><DepositTooltip value={usd(Number(reviewed.principalCents)/100)} assets={[
            {amount:tokenAmount(formatUnits(raw!.amount0,reviewed.plan.token0.decimals)),symbol:reviewed.plan.token0.symbol,address:reviewed.plan.token0.address},
            {amount:tokenAmount(formatUnits(raw!.amount1,reviewed.plan.token1.decimals)),symbol:reviewed.plan.token1.symbol,address:reviewed.plan.token1.address},
          ]}/></li>
          <li>You get: <b>{tokenAmount(formatUnits(BigInt(reviewed.plan.premium),reviewed.plan.variableDecimals))} {reviewed.plan.variableSymbol}</b>, claimable after the vault starts.</li>
          <li>Lock time: <b>{reviewed.snapshot.durationSeconds/86400} days</b>.</li>
        </>} details={<><p>The service pays creation gas. Your $2 ETH payment requests these exact terms. The campaign operator funds the premium externally before LP entry becomes available here.</p><p>LP amounts and deposit value are refreshed for your confirmation before you deposit. Impermanent loss can affect your LP position.</p><p>Robinhood Chain · full range.</p></>}/>
        {flow.saved&&<FinePrint>Your payment request is saved. Retry to recover it without paying twice.</FinePrint>}
        {flow.quote?.fee&&<FinePrint>Creation fee: $2 in ETH plus gas.</FinePrint>}
        {flow.saved?.sent&&<label>Existing payment transaction hash<input aria-label='Payment transaction hash' value={flow.recoveryHash} onChange={e=>flow.setRecoveryHash(e.target.value)} style={{width:'100%'}}/></label>}
        {flow.saved?.sent&&!flow.saved.hash&&flow.saved.nonce!==undefined&&<Disclosure><summary>Recover a missing transaction response</summary><p>Check payment first. If your wallet never returned a hash, retry the exact same fee at nonce {flow.saved.nonce}. Your wallet will ask for confirmation. If the quote expired, resolve or cancel that nonce in your wallet and enter the resulting hash here.</p><QuietButton disabled={busy} onClick={()=>void flow.pay(true)}>Retry same payment</QuietButton></Disclosure>}
        {flow.error&&<ErrorText role='alert'>{flow.error}</ErrorText>}
        <ModalAction disabled={busy||flow.saved?.status==='confirmed_unpaid'} onClick={()=>void flow.pay()}>{busy?'Confirming payment…':flow.saved?.sent?'Check payment':claimLabel}</ModalAction>
        {flow.saved?.sent&&<QuietButton disabled={busy} onClick={async()=>{await flow.startNew();onClose()}}>Create another vault</QuietButton>}
      </>:offer?<>
        {/* Keep one toggle mounted so expanding/collapsing preserves focus. Only
            the range controls collapse; Deposit and LP tokens remain visible. */}
        <Range aria-label='LP price range details'><Row><RangeToggle type='button' $expanded={lpDetailsOpen} aria-expanded={lpDetailsOpen} aria-controls={rangeId} onClick={()=>setLpDetailsOpen(!lpDetailsOpen)}>{lpDetailsOpen?'PRICE RANGE: FULL':'LP details'}</RangeToggle>{lpDetailsOpen&&<RangeSwitch aria-label='Invert price pair' onClick={()=>setInverted(!inverted)}>{inverted?offer.token1.symbol+' / '+offer.token0.symbol:pair} ⇄</RangeSwitch>}</Row><RangePlot id={rangeId} hidden={!lpDetailsOpen}><Track aria-hidden='true'><i/></Track><Row><Muted>0</Muted><Muted>{price.value?tokenAmount(inverted?1/price.value.quotePerToken:price.value.quotePerToken):'—'}</Muted><Muted>∞</Muted></Row></RangePlot></Range>
        <FormFieldGroup><FormLabel htmlFor='incentive-deposit'>Deposit</FormLabel><FormInput as={CurrencyInput} ref={attachDeposit} id='incentive-deposit' aria-label='Deposit value in US dollars' inputMode='decimal' prefix='$' groupSeparator=',' decimalSeparator='.' allowNegativeValue={false} disableAbbreviations decimalsLimit={2} value={deposit} maxLength={24} onValueChange={(value:string|undefined)=>setDeposit(value??'')}/>
          {offer.availability&&<FinePrint>{offer.availability}</FinePrint>}
        </FormFieldGroup>
        <FormFieldGroup><FormLabel as='h3' id={tokensId} style={{margin:0}}>LP tokens</FormLabel><TokenAmounts aria-labelledby={tokensId}>
          <Row><Token><TokenIcon symbol={offer.token0.symbol} size={24}/>{offer.token0.symbol}</Token><b>{tokenUsd?tokenAmount(amount/2/tokenUsd):'—'}</b></Row>
          <Row><Token><TokenIcon symbol={offer.token1.symbol} size={24}/>{offer.token1.symbol}</Token><b>{price.value?tokenAmount(amount/2/price.value.quoteUsd):'—'}</b></Row>
        </TokenAmounts></FormFieldGroup>
        <QuoteSummary aria-label='Position and premium estimate'><div><Label as='dt'>YOU DEPOSIT</Label><dd data-testid='position-value'>{usd(amount||0)}</dd></div><div><Label as='dt'>YOU GET</Label><dd data-testid='upfront-premium'>{tokenUsd?<><Token>{tokenAmount(reward/tokenUsd)}<TokenIcon symbol={offer.token0.symbol} size={20}/></Token><RewardValue>+{usd(reward)}</RewardValue></>:'—'}</dd></div></QuoteSummary>
        {price.error&&<Row><ErrorText role='alert'>{price.error}</ErrorText><QuietButton onClick={price.refresh}>Refresh price</QuietButton></Row>}
        {flow.error&&<ErrorText role='alert'>{flow.error}</ErrorText>}
        <ModalAction disabled={busy||!valid} onClick={()=>account?void flow.review(offer,deposit):onConnect()}>{busy?'Preparing deployment…':!account?'Connect wallet':'Continue'}</ModalAction>
      </>:null}
    </ModalContent>
  </Modal>
}

/** The shared base Button dims to 60% opacity on hover. Override only this
 * portal's enabled buttons: a 15% brightness lift is intentionally much gentler.
 * No disabled-state, outside navigation or touchscreen hover behavior changes. */
const ModalButtonHover=createGlobalStyle`
  [data-incentive-modal] button:not(:disabled):not([aria-disabled='true']){transition:filter 160ms ease,background-color 160ms ease,border-color 160ms ease;}
  @media(hover:hover) and (pointer:fine){
    [data-incentive-modal] button:not(:disabled):not([aria-disabled='true']):hover{opacity:1;filter:brightness(1.15);}
  }
  @media(prefers-reduced-motion:reduce){[data-incentive-modal] button{transition:none;}}
`
const Close = styled.button`position:absolute;right:12px;top:10px;background:none;border:0;color:inherit;font-size:24px;cursor:pointer;&:disabled{opacity:.5}`
// Normal flow reserves space for Back above the title, including narrow phones;
// the existing close control remains at the independent top-right corner.
const BackButton = styled(QuietButton).attrs({'data-incentive-back':''})`
  ${sidebarVariables(sidebarDefaults)}
  align-self:flex-start;display:block;width:fit-content;margin:0 32px 12px -10px;padding:7px 9px;min-height:36px;
  font-size:14px;color:#fff;background:transparent;border:1px solid transparent;border-radius:var(--sidebar-radius);
  transition:background-color .15s;
  &&:hover:not(:disabled){background:var(--sidebar-hover-background);border-color:transparent;color:#fff;}
  @media(prefers-reduced-motion:reduce){transition:none;}
`
const ClaimAmount=styled.span`color:#fff;`
const DepositReward = styled.div`display:flex;align-items:center;gap:10px;min-width:0;font-size:14px;line-height:1.5;>span:last-child{min-width:0;overflow-wrap:anywhere;}`
// ReactModal portals live outside the rail, so supply the same defaults here.
// The lab editor targets this marker too; it never changes button typography,
// validation, click handlers, or disabled/busy opacity and pointer behavior.
const ModalAction = styled(Action).attrs({ 'data-incentive-primary-action': '' })`
  ${sidebarVariables(sidebarDefaults)}
  &&, &&:hover:not(:disabled){${sidebarSelectedSurface}}
  border:1px solid var(--sidebar-button-border);border-radius:var(--sidebar-radius);
  &:focus-visible{outline:2px solid var(--sidebar-start);outline-offset:3px;}
  @media(prefers-reduced-motion:reduce){&&, &&:hover:not(:disabled){animation:none;background-position:50% 50%;}}
`
// Two text rows leave a dedicated right-hand slot for the interactive emblem.
const Header = styled.div<{ $hasLogo: boolean }>`display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:8px;padding-top:${({ $hasLogo }) => $hasLogo ? '16px' : '0'};margin-bottom:24px;`
const RequestTitle = styled(ModalTitle)`min-width:0;margin-bottom:0;[data-claim-amount]{color:${({theme})=>theme.colors.semantic.success};}&:focus{outline:none;}`
const TitleContent = styled.span`display:flex;flex-direction:column;align-items:flex-start;gap:16px;`
const PairIcons = styled.span`display:inline-flex;align-items:center;img+img{margin-left:-6px;}`
const TitleStats = styled.span`display:inline-flex;align-items:center;gap:16px;`
// The same APR marker shares staging animation/speed settings with the table.
// Keep a readable static gradient when motion is disabled or Tweak is absent.
const TitleApr = styled(Premium)`
  font-size:16px;white-space:nowrap;font-family:"Funnel Display", serif;font-weight:500 !important;
  ${aprTextPaint}
`
const TitleDays = styled(Muted)`font-size:14px;white-space:nowrap;font-weight:400;`
const Range = styled.div`display:flex;flex-direction:column;gap:12px;`
const RangePlot=styled.div`display:flex;flex-direction:column;gap:12px;&[hidden]{display:none;}`
const RangeToggle=styled.button<{$expanded:boolean}>`
  display:inline-flex;align-items:center;gap:8px;border:0;padding:0;background:none;cursor:pointer;text-align:left;
  font-family:"Funnel Display",sans-serif;font-size:${p=>p.$expanded?'11px':'13px'};font-weight:${p=>p.$expanded?'400':'500'};line-height:1.5;
  letter-spacing:${p=>p.$expanded?'.06em':'normal'};color:${p=>p.$expanded?p.theme.colors.text.label:p.theme.colors.text.secondary};
  /* A filled disclosure marker matches the reference without relying on a
     font-specific chevron glyph. The expanded heading stays plain/clickable. */
  &::before{content:'';display:${p=>p.$expanded?'none':'block'};flex:none;width:0;height:0;border-top:4px solid transparent;border-bottom:4px solid transparent;border-left:7px solid currentColor;}
  &:hover{color:${({theme})=>theme.colors.text.primary};}
  &:focus-visible{outline:2px solid ${({theme})=>theme.colors.accent.gold};outline-offset:4px;border-radius:3px;}
`
const RangeSwitch = styled(QuietButton)`border:0;background:${({ theme }) => theme.colors.background.tertiary};
  &:hover{background:${({ theme }) => theme.colors.background.tertiary};}
`
// Match the shared form field border only inside the vault modal. Page rows
// keep their own styling; the border-free range switch keeps its zero width.
const ModalContent = styled(Stack)<{$amountPage:boolean}>`
  ${Disclosure}, ${QuietButton}{border-color:${({ theme }) => theme.colors.border.base};}
  ${QuietButton}:hover:not(:disabled){border-color:${({ theme }) => theme.colors.accent.gold};}
  /* Replace the amount page's mono label/control font only. Other pages and
     the existing body, headings and APR typography keep their own settings. */
  ${p=>p.$amountPage&&css`${Label}, ${RangeSwitch}, [data-incentive-primary-action]{font-family:"Funnel Display",sans-serif;}`}
`
// The rounded white marker stays centered over the solid full-range track.
const Track = styled.div`height:8px;border-radius:8px;background:${({ theme }) => theme.colors.green.base};position:relative;
  i{position:absolute;left:50%;transform:translateX(-50%);top:-6px;width:5px;height:20px;border-radius:4px;background:${({ theme }) => theme.colors.background.white}}`
const TokenAmounts = styled.div`display:flex;flex-direction:column;gap:16px;padding:14px;border:1px solid ${({ theme }) => theme.colors.border.base};border-radius:var(--radius-md);font-size:14px;
  b{font-weight:600;text-align:right;font-variant-numeric:tabular-nums;}`
// Wrapping long reward amounts keeps the summary inside narrow phone dialogs.
const QuoteSummary = styled.dl`margin:0;display:flex;flex-direction:column;gap:16px;
  >div{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;min-height:24px;}
  dd{margin:0 0 0 auto;display:flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;font-size:16px;font-weight:600;font-variant-numeric:tabular-nums;}
`
const RewardValue = styled.b`color:${({ theme }) => theme.colors.semantic.success};white-space:nowrap;`
const Terms = styled.dl`margin:16px 0;display:flex;flex-direction:column;gap:10px;div{display:flex;justify-content:space-between;gap:16px}dt{color:${({ theme }) => theme.colors.text.tertiary}}dd{margin:0;text-align:right}`
const Receipt = styled.div`display:flex;flex-direction:column;gap:10px;overflow-wrap:anywhere;`
const Success = styled.p`margin:0;line-height:1.6;color:${({ theme }) => theme.colors.semantic.success};font-size:14px;overflow-wrap:anywhere;`
