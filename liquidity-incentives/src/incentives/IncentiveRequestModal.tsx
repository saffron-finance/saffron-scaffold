import { useCallback, useEffect, useId, useRef, useState } from 'react'
import CurrencyInput from 'react-currency-input-field'
import type { Address } from 'viem'
import styled from 'styled-components'
import { validDetails, type RequestDetails } from '@receipt'
import { FormFieldGroup, FormInput, FormLabel, Modal, ModalTitle, InteractiveEmblem } from '../host/ui'
import type { RequestFlow } from '../host/useRequestFlow'
import type { useOfferPrice } from '../host/useOfferPrice'
import { exactUsd, freshQuote, requestDraft, tokenAmount, usd, type Offer } from './model'
import { Action, Disclosure, ErrorText, FinePrint, Label, Muted, Premium, QuietButton, Row, Stack, Token } from './styles'
import { TokenIcon } from './TokenIcon'
import { RequestFeeSelector } from './RequestFeeSelector'
import { VaultReview } from './VaultReview'

interface Props {
  offer: Offer
  account: Address | null
  flow: RequestFlow
  price: ReturnType<typeof useOfferPrice>
  onClose: () => void
}

/** Review is an immutable snapshot. Price refreshes cannot change signed terms;
 * the durable payment state lives above this dialog in IncentivesPage. */
export function IncentiveRequestModal({ offer, account, flow, price, onClose }: Props) {
  const [deposit, setDeposit] = useState('100')
  const [reviewed, setReviewed] = useState<RequestDetails | null>(null)
  const [inverted, setInverted] = useState(false)
  const [now, setNow] = useState(Date.now)
  const titleId = useId()
  const titleRef = useRef<HTMLDivElement | null>(null)
  const attachTitle = useCallback((node: HTMLDivElement | null) => {
    titleRef.current = node
    node?.closest('[role="dialog"]')?.setAttribute('aria-labelledby', titleId)
    node?.focus()
  }, [titleId])
  const amount = Number(deposit)
  const draft = price.value && amount > 0 && amount <= offer.capacityUsd
    ? requestDraft(offer, deposit, price.value) : null
  const confirming = Boolean(reviewed || flow.pending)
  const request = flow.pending ?? reviewed ?? draft
  const terms = request?.incentive
  const quote = terms?.quote
  const pair = `${offer.token0.symbol} / ${offer.token1.symbol}`
  const locked = flow.busy || Boolean(flow.pending)
  const close = () => { if (!flow.busy) onClose() }
  const expired = Boolean(reviewed && !flow.pending && !freshQuote(reviewed.incentive?.quote.quotedAt, now))
  // Continue/Done replace the focused action. Move focus inside the dialog so
  // its title is announced and Escape remains routed through ReactModal.
  const done = flow.step === 'done'
  useEffect(() => { titleRef.current?.focus() }, [confirming, done])

  // A frozen review may sit open longer than its live price poll. Expire the
  // button at the deadline and check again on click after background throttling.
  useEffect(() => {
    if (!reviewed || flow.pending) return
    const delay = Date.parse(reviewed.incentive!.quote.quotedAt) + 120_000 - Date.now()
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, delay))
    return () => window.clearTimeout(timer)
  }, [reviewed, flow.pending])

  function submitReviewed() {
    if (!request) return
    if (!flow.pending && !freshQuote(request.incentive?.quote.quotedAt)) { setNow(Date.now()); return }
    void flow.submit(request)
  }

  /** Download the original envelope; even a cancelled signature can be resumed. */
  function saveReceipt() {
    if (!flow.pending) return
    const url = URL.createObjectURL(new Blob([JSON.stringify(flow.pending, null, 2)], { type: 'application/json' }))
    const link = document.createElement('a')
    link.href = url; link.download = 'saffron-incentive-request.json'; link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return <Modal isOpen onRequestClose={close} shouldCloseOnOverlayClick={!flow.busy}
    contentStyle={{ padding: '10px 28px 26px 28px' }}>
    <Close type='button' aria-label='Close incentive request' onClick={close} disabled={flow.busy}>×</Close>
    <Header $hasLogo={!confirming}>
    <RequestTitle id={titleId} role='heading' aria-level={2} tabIndex={-1} ref={attachTitle}>
      {confirming ? `Claim ${usd(quote?.rewardUsd ?? 0)}` : <TitleContent>
        <Token><PairIcons><TokenIcon symbol={offer.token0.symbol} size={24} /><TokenIcon symbol={offer.token1.symbol} size={24} /></PairIcons>{pair}</Token>
        <TitleStats><TitleApr data-incentive-apr>{offer.apr.toLocaleString('en-US')}% APR</TitleApr><TitleDays>{offer.days} days</TitleDays></TitleStats>
      </TitleContent>}</RequestTitle>
      {!confirming && <InteractiveEmblem />}
    </Header>
    <ModalContent>
      {!confirming ? <>
        <Range aria-label='Full price range'>
          <Row><Label>Price range: full</Label><RangeSwitch type='button' onClick={() => setInverted(value => !value)}
            aria-label='Invert price pair'>{inverted ? `${offer.token1.symbol} / ${offer.token0.symbol}` : pair} ⇄</RangeSwitch></Row>
          <Track aria-hidden='true'><i /></Track>
          <Row><Muted>0</Muted><Muted>{price.value
            ? (inverted ? 1 / price.value.quotePerToken : price.value.quotePerToken).toLocaleString('en-US', { maximumSignificantDigits: 5 })
            : '—'}</Muted><Muted>∞</Muted></Row>
        </Range>
        <FormFieldGroup><FormLabel htmlFor='incentive-deposit'>Deposit</FormLabel>
          {/* Same formatter and field styles as create-vault. Store its raw string,
              never the dollar prefix/grouping, so signed amounts stay canonical. */}
          <FormInput as={CurrencyInput} id='incentive-deposit' aria-label='Deposit value in US dollars' inputMode='decimal'
            prefix='$' groupSeparator=',' decimalSeparator='.' allowNegativeValue={false} disableAbbreviations
            decimalsLimit={2} placeholder='$0.00' value={deposit} maxLength={24}
            onValueChange={(value: string | undefined) => setDeposit(value ?? '')} />
          {amount > offer.capacityUsd && <ErrorText>Amount exceeds the {usd(offer.capacityUsd)} capacity.</ErrorText>}
        </FormFieldGroup>
        <FormFieldGroup><FormLabel as='div' id={`${titleId}-tokens`}>Tokens required for LP</FormLabel>
          <TokenAmounts role='group' aria-labelledby={`${titleId}-tokens`}><Row><Token><TokenIcon symbol={offer.token0.symbol} size={24} />{offer.token0.symbol}</Token><b>{quote ? tokenAmount(quote.cashcatAmount) : '—'}</b></Row>
            <Row><Token><TokenIcon symbol={offer.token1.symbol} size={24} />{offer.token1.symbol}</Token><b>{quote ? tokenAmount(quote.quoteAmount) : '—'}</b></Row></TokenAmounts>
        </FormFieldGroup>
        {/* Sum both unrounded LP legs; the reward is separate from principal.
            Reuse the exact quote that Continue freezes for the next screen. */}
        <QuoteSummary aria-label='Position and premium estimate'>
          <div><Label as='dt'>Your deposit</Label><dd data-testid='position-value'>{quote
            ? usd(quote.cashcatAmount * quote.cashcatUsd + quote.quoteAmount * quote.quoteTokenUsd) : '—'}</dd></div>
          <div><Label as='dt'>You get</Label><dd data-testid='upfront-premium'>{quote ? <>
            <Token title={offer.token0.symbol} aria-label={offer.token0.symbol}>{tokenAmount(quote.rewardCashcat)}<TokenIcon symbol={offer.token0.symbol} size={20} /></Token>
            <Muted aria-hidden='true'>=</Muted><RewardValue>+{usd(quote.rewardUsd)}</RewardValue>
          </> : '—'}</dd></div>
        </QuoteSummary>
        {price.error && <Row><ErrorText role='alert'>{price.error}</ErrorText><QuietButton onClick={price.refresh}>Refresh price</QuietButton></Row>}
        {flow.error && <ErrorText role='alert'>{flow.error}</ErrorText>}
        <Action type='button' disabled={!draft || !validDetails(draft) || price.loading || flow.busy}
          onClick={() => { setNow(Date.now()); setReviewed(draft) }}>Continue</Action>
      </> : quote && terms ? <>
        {!locked && <QuietButton type='button' onClick={() => setReviewed(null)}>← Back to deposit</QuietButton>}
        <VaultReview bullets={<>
          <li><b>{tokenAmount(quote.cashcatAmount)} {terms.token0.symbol}</b> and <b>{tokenAmount(quote.quoteAmount)} {terms.token1.symbol}</b> are the requested Uniswap LP deposit.</li>
          <li>Requested LP lock: <b>{terms.durationDays} days</b>.</li>
          <li>Requested upfront reward: <Premium>+{tokenAmount(quote.rewardCashcat)} {terms.token0.symbol} ({usd(quote.rewardUsd)})</Premium>.</li>
          <li>Your position may suffer <b>impermanent loss</b>.</li>
          <li>Fee: <b>{flow.feeLabel}</b>{flow.selectedAsset === 'ETH' && ' (approximately $2)'}, plus ETH for network gas.</li>
        </>} details={<>
          <Terms>
            <div><dt>Pair / network</dt><dd>{request?.pair}, {terms.chainId === 4663 ? 'Robinhood Chain' : `Chain ${terms.chainId}`}</dd></div>
            <div><dt>Requested vault size</dt><dd>{exactUsd(terms.depositUsd)}</dd></div>
            <div><dt>Program maximum</dt><dd>{usd(terms.capacityUsd)}</dd></div>
            <div><dt>Duration / APR</dt><dd>{terms.durationDays} days, {terms.aprPercent.toLocaleString()}% APR</dd></div>
            <div><dt>Upfront premium</dt><dd>+{tokenAmount(quote.rewardCashcat)} {terms.token0.symbol} ({usd(quote.rewardUsd)})</dd></div>
            <div><dt>Price range</dt><dd>Full range, 0 to ∞</dd></div>
          </Terms>
          <p>Request submits these terms for operator review. Sign the request details for free after the fee payment. Only the fee is transferred now; the LP deposit awaits vault creation and full admin premium funding.</p>
          <p>Requested liquidity: Uniswap v3.</p>
        </>} />
        {flow.pending && <Receipt><FinePrint>Payment: <a href={`https://arbiscan.io/tx/${flow.pending.paymentTxHash}`}
          target='_blank' rel='noreferrer'>{flow.pending.paymentTxHash}</a></FinePrint><QuietButton onClick={saveReceipt}>Save request receipt</QuietButton></Receipt>}
        {flow.storageWarning && <ErrorText role='alert'>Browser storage is unavailable. Save your request receipt before closing.</ErrorText>}
        {flow.error && <ErrorText role='alert'>{flow.error}</ErrorText>}
        {expired && !flow.busy && <>
          <ErrorText role='alert'>This price review expired. Refresh and review the updated amounts before paying.</ErrorText>
          <QuietButton onClick={() => { setReviewed(null); price.refresh() }}>Refresh and review</QuietButton>
        </>}
        {flow.config && !flow.config.enabled && !flow.pending && <ErrorText>Payment collection is not configured yet. No fee can be sent.</ErrorText>}
        {!flow.config && !flow.pending && !flow.error && <FinePrint role='status'>Loading payment configuration…</FinePrint>}
        <FinePrint>Vault request does not guarantee deployment or a payout.</FinePrint>
        {flow.step === 'done' ? <>
          <Success role='status'>Request <code>{flow.requestId}</code> is paid and pending review.</Success>
          <Action onClick={() => { flow.clearFinished(); onClose() }}>Done</Action>
        </> : <>
          <RequestFeeSelector flow={flow} connected={Boolean(account)} />
          <Action type='button' disabled={flow.busy || Boolean(flow.confirmedFailure) || expired || !request || !validDetails(request)
            || (!flow.pending && (!flow.config?.enabled || (Boolean(account) && !flow.canPay)))}
            onClick={submitReviewed}>
            {flow.busy ? ({ paying: `Confirm ${flow.selectedAsset} payment…`, confirming: 'Confirming payment…',
              signing: 'Sign request details…', saving: 'Saving request…' } as Record<string, string>)[flow.step]
              : !account ? 'Connect wallet' : flow.pending ? 'Resume request — no new payment' : 'Request'}
          </Action>
        </>}
        {flow.confirmedFailure && <QuietButton onClick={() => { flow.clearFinished(); setReviewed(null) }}>
          {flow.confirmedFailure === 'cancelled' ? 'Clear confirmed cancelled payment' : 'Clear confirmed failed payment'}
        </QuietButton>}
      </> : null}
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
// Match the shared form field border only inside the request modal. Page rows
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
