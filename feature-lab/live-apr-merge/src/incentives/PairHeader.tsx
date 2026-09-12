import styled from 'styled-components'
import type { Offer } from './model'
import { TokenIcon } from './TokenIcon'
import uniswapLogo from './assets/uniswap.svg'
import robinhoodLogo from './assets/robinhood.svg'
import { mobileHomeMaxWidth } from '../host/MobileHomeNavigation'

/** Presentational header extracted from scaffold live-pool-apr/LivePoolAprPage.
 * Keeps its original artwork, copy and typography without importing the live
 * monitor, subscriptions or host shell. Offer metadata owns the pair/fee. */
export function PairHeader({ pair: { token0, token1, feeTier } }: { pair: Offer }) {
  return <><Header>
    <Title><PairHeading data-testid='pool-pair-heading'>
      <PairLogos aria-hidden='true'><PairLogo><TokenIcon {...token0} size={48} /></PairLogo><PairLogo><TokenIcon {...token1} size={48} /></PairLogo></PairLogos>
      <PairHeadingText>
        <PairName data-testid='pool-pair-name'>{token0.symbol} / {token1.symbol} {(feeTier ?? 0) / 10_000}%</PairName>
      </PairHeadingText>
    </PairHeading></Title>
    <Description><PoolDescription data-testid='pool-description'>
      <DescriptionItem><UniswapDescriptionLogo src={uniswapLogo} alt='' aria-hidden='true' />Uniswap v3</DescriptionItem>
      <DescriptionItem><DescriptionLogo src={robinhoodLogo} alt='' aria-hidden='true' />Robinhood Chain</DescriptionItem>
    </PoolDescription></Description>
  </Header>
    {/* This compact Home-only header matches the approved concept. The larger
        desktop header above retains its fee-tier and venue description. */}
    <PhoneHeader data-mobile-pair>
      <h2><span aria-hidden='true'><TokenIcon {...token0} size={26} compact /><TokenIcon {...token1} size={26} compact /></span>{token0.symbol} / {token1.symbol}</h2>
      <span><img src={robinhoodLogo} alt='' />Robinhood</span>
    </PhoneHeader>
  </>
}

// AppPageShell's header text geometry, without its app surface or navigation.
const Header = styled.header`max-width:760px;@media(max-width:${mobileHomeMaxWidth}px){display:none;}`
const PhoneHeader = styled.header`
  display:none;
  @media(max-width:${mobileHomeMaxWidth}px){
    display:flex;justify-content:space-between;align-items:center;gap:10px;min-width:0;
    h2{display:flex;align-items:center;gap:8px;margin:0 0 10px;min-width:0;font:400 16px/1.45 "Funnel Display",sans-serif;}
    h2>span{display:inline-flex;align-items:center;flex-shrink:0;}
    h2 img+img{margin-left:-6px;background:#191919;border:2px solid #000;}
    >span{display:flex;align-items:center;gap:5px;white-space:nowrap;font-size:11px;color:#a09ca5;}
    >span img{width:13px;height:13px;}
  }
`
const Title = styled.h2`margin:0;line-height:1;`
const Description = styled.p`max-width:680px;margin:18px 0 0;color:${({ theme }) => theme.colors.text.secondary};font-size:16px;line-height:1.55;`
// Exact LivePoolAprPage header styles. Assets are local, with no lookup calls.
const PairHeading = styled.span`
  display: flex;
  align-items: center;
  gap: 16px;
  /* Preserve the reference's white dark-mode heading and support beta light. */
  color: ${({ theme }) => theme.colors.text.primary};
  font-family: ${({ theme }) => theme.fonts.body};
  letter-spacing: -0.03em;
  @media (max-width: 480px) { gap: 12px; }
`
const PairLogos = styled.span`
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  > * + * { margin-left: -12px; }
`
const PairLogo = styled.span`
  display: block;
  width: 48px;
  height: 48px;
  object-fit: cover;
  border: 2px solid ${({ theme }) => theme.colors.background.base};
  border-radius: 50%;
  overflow: hidden;
  > * { width: 100% !important; height: 100% !important; }
  @media (max-width: 480px) { width: 42px; height: 42px; }
`
const PairHeadingText = styled.span`
  display: flex;
  flex-direction: column;
  gap: 7px;
  min-width: 0;
`
const PairName = styled.span`
  font-family: ${({ theme }) => theme.fonts.display};
  font-size: clamp(22px, 5.8vw, 42px);
  font-weight: 300;
  line-height: 1.12;
  letter-spacing: normal;
  overflow-wrap: anywhere;
  @media (max-width: 360px) { font-size: 19px; }
`
const PoolDescription = styled.span`
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 20px;
  @media (max-width: 480px) { font-size: 14px; gap: 10px 16px; }
`
const DescriptionItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
`
const DescriptionLogo = styled.img`
  display: block;
  width: 1em;
  height: 1em;
  flex: 0 0 1em;
  object-fit: contain;
`
// Uniswap artwork has the source's 2px optical adjustment; Robinhood does not.
const UniswapDescriptionLogo = styled(DescriptionLogo)`
  width: calc(1em + 2px);
  height: calc(1em + 2px);
  flex-basis: calc(1em + 2px);
`
