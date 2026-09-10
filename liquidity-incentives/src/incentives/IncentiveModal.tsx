import { useCallback,useEffect,useId,useRef,useState } from 'react'
import CurrencyInput from 'react-currency-input-field'
import { formatUnits,type Address } from 'viem'
import styled from 'styled-components'
import { FormFieldGroup,FormInput,FormLabel,Modal,ModalTitle,InteractiveEmblem } from '../host/ui'
import type { useDeploymentFlow } from '../host/useDeploymentFlow'
import type { useOfferPrice } from '../host/useOfferPrice'
import { tokenAmount,usd,type Offer } from './model'
import { amountsForLiquidity } from '../../shared/liquidity-math.mjs'
import { Action,Disclosure,ErrorText,FinePrint,Label,Muted,Premium,QuietButton,Row,Stack,Token } from './styles'
import { TokenIcon } from './TokenIcon'
import { VaultReview } from './VaultReview'
import { VaultLifecyclePanel } from './VaultLifecyclePanel'

export function IncentiveModal({offer,account,flow,price,deploymentId,onClose,onConnect}:{offer:Offer|null;account:Address|null;flow:ReturnType<typeof useDeploymentFlow>;price:ReturnType<typeof useOfferPrice>;deploymentId?:string|null;onClose:()=>void;onConnect:()=>void}){
  const [deposit,setDeposit]=useState('100'),[inverted,setInverted]=useState(false),[nativeBusy,setNativeBusy]=useState(false),[now,setNow]=useState(Date.now)
  const id=deploymentId??flow.deployment?.id,reviewed=flow.quote
  const second=Boolean(id||reviewed),busy=flow.busy||nativeBusy
  const titleId=useId(),titleRef=useRef<HTMLDivElement|null>(null)
  const attachTitle=useCallback((node:HTMLDivElement|null)=>{titleRef.current=node;node?.closest('[role="dialog"]')?.setAttribute('aria-labelledby',titleId)},[titleId])
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
  useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return ()=>clearInterval(timer)},[])
  const amount=Number(deposit),max=offer?.eligibleMaximumCents?Number(offer.eligibleMaximumCents)/100:0
  const minimum=offer?Number(offer.minimumCents)/100:0
  const valid=!!offer&&Number.isFinite(amount)&&amount>=minimum&&amount<=max&&Boolean(price.value)&&!price.loading
  const tokenUsd=price.value?price.value.quotePerToken*price.value.quoteUsd:0
  const reward=offer?amount*offer.apr/100*offer.days/365:0
  const pair=offer?offer.token0.symbol+' / '+offer.token1.symbol:''
  const expired=reviewed&&Date.parse(reviewed.expiresAt)<=now
  const raw=reviewed?amountsForLiquidity(reviewed.plan.liquidity,reviewed.plan.sqrtPrice,reviewed.plan.minTick,reviewed.plan.maxTick):null
  const close=()=>{if(!busy)onClose()}
  return <Modal isOpen onRequestClose={close} shouldCloseOnOverlayClick={!busy} contentStyle={{padding:'10px 28px 26px 28px'}}>
    <Close aria-label='Close incentive vault' disabled={busy} onClick={close}>×</Close>
    <Header $hasLogo={!second}><RequestTitle id={titleId} role='heading' aria-level={2} tabIndex={-1} ref={attachTitle}>
      {second?(id?'Your incentive vault':'Review deployment'):<TitleContent><Token><PairIcons><TokenIcon symbol={offer!.token0.symbol} size={24}/><TokenIcon symbol={offer!.token1.symbol} size={24}/></PairIcons>{pair}</Token>
        <TitleStats><TitleApr data-incentive-apr>{offer!.apr.toLocaleString()}% APR</TitleApr><TitleDays>{offer!.days} days</TitleDays></TitleStats></TitleContent>}
    </RequestTitle>{!second&&<InteractiveEmblem/>}</Header>
    <ModalContent>
      {id&&account?<VaultLifecyclePanel key={account+id} account={account} id={id} onBusy={setNativeBusy}/>:reviewed?<>
        <VaultReview label='Deployment summary' bullets={<>
          <li>LP value at authorization: <b>{usd(Number(reviewed.principalCents)/100)}</b>.</li>
          <li>Estimated LP: <b>{formatUnits(raw!.amount0,reviewed.plan.token0.decimals)} {reviewed.plan.token0.symbol}</b> and <b>{formatUnits(raw!.amount1,reviewed.plan.token1.decimals)} {reviewed.plan.token1.symbol}</b>.</li>
          <li>Lock after start: <b>{reviewed.snapshot.durationSeconds/86400} days</b>.</li>
          <li>Premium: <b>{formatUnits(BigInt(reviewed.plan.premium),reviewed.plan.variableDecimals)} {reviewed.plan.variableSymbol}</b>, claimable after the vault starts.</li>
        </>} details={<><p>The service pays creation gas. Your signature authorizes these exact terms. An admin funds the premium before LP entry becomes available here.</p><p>LP amounts are refreshed at entry and may change with price. Impermanent loss can affect your LP position.</p><p>Robinhood Chain · full range. Quote expires {new Date(reviewed.expiresAt).toLocaleTimeString()}.</p></>}/>
        {flow.saved&&<FinePrint>Your signed authorization is saved. Retry it to recover the original deployment.</FinePrint>}
        {expired&&!flow.saved&&<ErrorText>Quote expired. Refresh the terms before authorizing.</ErrorText>}
        {flow.error&&<ErrorText role='alert'>{flow.error}</ErrorText>}
        <Action disabled={busy||Boolean(expired&&!flow.saved)} onClick={()=>void flow.authorize()}>{busy?'Confirming deployment…':flow.saved?'Resume deployment':'Authorize deployment'}</Action>
        {flow.saved?<QuietButton disabled={busy} onClick={()=>void flow.discardRejected()}>Check saved authorization</QuietButton>:<QuietButton disabled={busy} onClick={flow.reset}>Change amount / refresh quote</QuietButton>}
      </>:offer?<>
        <Range aria-label='Full price range'><Row><Label>Price range: full</Label><RangeSwitch aria-label='Invert price pair' onClick={()=>setInverted(!inverted)}>{inverted?offer.token1.symbol+' / '+offer.token0.symbol:pair} ⇄</RangeSwitch></Row><Track aria-hidden='true'><i/></Track><Row><Muted>0</Muted><Muted>{price.value?tokenAmount(inverted?1/price.value.quotePerToken:price.value.quotePerToken):'—'}</Muted><Muted>∞</Muted></Row></Range>
        <FormFieldGroup><FormLabel htmlFor='incentive-deposit'>LP deposit value</FormLabel><FormInput as={CurrencyInput} ref={attachDeposit} id='incentive-deposit' aria-label='Deposit value in US dollars' inputMode='decimal' prefix='$' groupSeparator=',' decimalSeparator='.' allowNegativeValue={false} disableAbbreviations decimalsLimit={2} value={deposit} maxLength={24} onValueChange={(value:string|undefined)=>setDeposit(value??'')}/>
          <FinePrint>{offer.eligibleMaximumCents===null?'Live capacity unavailable':max>0?usd(minimum)+' minimum · '+usd(max)+' available per vault':'This campaign currently has no available capacity.'}</FinePrint>
          {amount>max&&max>0&&<ErrorText>Amount exceeds the available {usd(max)}.</ErrorText>}
        </FormFieldGroup>
        <TokenAmounts aria-label='Estimated LP assets'>
          <Row><Token><TokenIcon symbol={offer.token0.symbol} size={24}/>{offer.token0.symbol}</Token><b>{tokenUsd?tokenAmount(amount/2/tokenUsd):'—'}</b></Row>
          <Row><Token><TokenIcon symbol={offer.token1.symbol} size={24}/>{offer.token1.symbol}</Token><b>{price.value?tokenAmount(amount/2/price.value.quoteUsd):'—'}</b></Row>
        </TokenAmounts>
        <QuoteSummary aria-label='Position and premium estimate'><div><Label as='dt'>Your deposit</Label><dd data-testid='position-value'>{usd(amount||0)}</dd></div><div><Label as='dt'>Expected premium</Label><dd data-testid='upfront-premium'>{tokenUsd?<><Token>{tokenAmount(reward/tokenUsd)}<TokenIcon symbol={offer.token0.symbol} size={20}/></Token><RewardValue>+{usd(reward)}</RewardValue></>:'—'}</dd></div></QuoteSummary>
        <FinePrint>No application fee. Continue to sign in and review an exact deployment quote. LP assets are deposited after creation and admin funding.</FinePrint>
        {price.error&&<Row><ErrorText role='alert'>{price.error}</ErrorText><QuietButton onClick={price.refresh}>Refresh price</QuietButton></Row>}
        {flow.error&&<ErrorText role='alert'>{flow.error}</ErrorText>}
        <Action disabled={busy||!valid} onClick={()=>account?void flow.review(offer,deposit):onConnect()}>{busy?'Preparing deployment…':!account?'Connect wallet':'Continue'}</Action>
      </>:null}
    </ModalContent>
  </Modal>
}

const Close = styled.button`position:absolute;right:12px;top:10px;background:none;border:0;color:inherit;font-size:24px;cursor:pointer;&:disabled{opacity:.5}`
// Two text rows leave a dedicated right-hand slot for the interactive emblem.
const Header = styled.div<{ $hasLogo: boolean }>`display:flex;align-items:center;justify-content:space-between;gap:12px;padding-right:8px;padding-top:${({ $hasLogo }) => $hasLogo ? '16px' : '0'};margin-bottom:24px;`
const RequestTitle = styled(ModalTitle)`min-width:0;margin-bottom:0;&:focus{outline:none;}`
const TitleContent = styled.span`display:flex;flex-direction:column;align-items:flex-start;gap:16px;`
const PairIcons = styled.span`display:inline-flex;align-items:center;img+img{margin-left:-6px;}`
const TitleStats = styled.span`display:inline-flex;align-items:center;gap:16px;`
// The same APR marker shares staging animation/speed settings with the table.
// Keep a readable static gradient when motion is disabled or Tweak is absent.
const TitleApr = styled(Premium)`
  font-size:16px;white-space:nowrap;font-family:"Funnel Display", serif;font-weight:500 !important;
  background-image:linear-gradient(110deg, rgb(255, 188, 9) 10%, rgb(228, 126, 1) 65%, rgb(250, 63, 6) 100%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
`
const TitleDays = styled(Muted)`font-size:14px;white-space:nowrap;font-weight:400;`
const Range = styled.div`display:flex;flex-direction:column;gap:12px;`
const RangeSwitch = styled(QuietButton)`border:0;background:${({ theme }) => theme.colors.background.tertiary};
  &:hover{background:${({ theme }) => theme.colors.background.tertiary};}
`
// Match the shared form field border only inside the vault modal. Page rows
// keep their own styling; the border-free range switch keeps its zero width.
const ModalContent = styled(Stack)`
  ${Disclosure}, ${QuietButton}{border-color:${({ theme }) => theme.colors.border.base};}
  ${QuietButton}:hover:not(:disabled){border-color:${({ theme }) => theme.colors.accent.gold};}
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
