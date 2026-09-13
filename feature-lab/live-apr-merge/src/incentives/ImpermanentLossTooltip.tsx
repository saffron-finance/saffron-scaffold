import styled from 'styled-components'
import uniswapIcon from './assets/uniswap.svg'
import {InlineTooltip} from './DepositTooltip'

/** Risk disclosure is display-only. Its explicit external documentation link
 * opens independently and never changes the checkout or triggers wallet work. */
export function ImpermanentLossTooltip(){
  return <InlineTooltip label='impermanent loss' prefix='Your position may suffer ' suffix='.' interactive>
    <Definition>Impermanent loss (IL) on Uniswap occurs when the dollar value of your pooled tokens drops compared to simply holding them in a wallet due to external market price shifts.</Definition>
    <Documentation href='https://support.uniswap.org/hc/en-us/articles/20904453751693-What-is-Impermanent-Loss' target='_blank' rel='noopener noreferrer'>
      <img src={uniswapIcon} width={16} height={16} alt='' aria-hidden='true'/>Uniswap Documentation
    </Documentation>
  </InlineTooltip>
}

const Definition=styled.span`display:block;line-height:1.4;`
const Documentation=styled.a`
  display:inline-flex;align-items:center;gap:6px;align-self:flex-start;margin-top:7px;
  color:#d286ff;text-decoration:underline;text-underline-offset:3px;line-height:1.5;
  img{flex:none;object-fit:contain;}
  &:focus-visible{outline:2px solid #d286ff;outline-offset:3px;border-radius:2px;}
`
