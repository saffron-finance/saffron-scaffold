import './PairHeader.css'
import type { Offer } from './model'
import { TokenIcon } from './TokenIcon'
import uniswapLogo from './assets/uniswap.svg'
import robinhoodLogo from './assets/robinhood.svg'
import { mobileHomeMaxWidth } from '../host/MobileHomeNavigation'

/** Presentational header extracted from scaffold live-pool-apr/LivePoolAprPage.
 * Keeps its original artwork, copy and typography without importing the live
 * monitor, subscriptions or host shell. Offer metadata owns the pair/fee. */
export function PairHeader({ pair: { token0, token1, feeTier } }: { pair: Offer }) {
  return <><header className='saffron-pair-header'>
    <h2 className='saffron-pair-title'><span className='saffron-pair-pair-heading' data-testid='pool-pair-heading'>
      <span className='saffron-pair-pair-logos' aria-hidden='true'><span className='saffron-pair-pair-logo'><TokenIcon {...token0} size={40} /></span><span className='saffron-pair-pair-logo'><TokenIcon {...token1} size={40} /></span></span>
      <span className='saffron-pair-pair-heading-text'>
        <span className='saffron-pair-pair-name' data-testid='pool-pair-name'>{token0.symbol} / {token1.symbol} {(feeTier ?? 0) / 10_000}%</span>
      </span>
    </span></h2>
  </header>
    {/* This compact Home-only header matches the approved concept. The larger
        desktop header above retains its fee-tier and venue description. */}
    <header className='saffron-pair-phone-header' data-mobile-pair>
      <h2><span aria-hidden='true'><TokenIcon {...token0} size={26} compact /><TokenIcon {...token1} size={26} compact /></span>{token0.symbol} / {token1.symbol}</h2>
    </header>
  </>
}

/** Venue metadata follows the offers on every screen size. */
export function PairDescription(){return <p className='saffron-pair-description' data-testid='pool-description'><span className='saffron-pair-pool-description'>
  <span className='saffron-pair-description-item'><img className='saffron-pair-uniswap-description-logo' src={uniswapLogo} alt='' aria-hidden='true'/>Uniswap v3</span>
  <span className='saffron-pair-description-item'><img className='saffron-pair-description-logo' src={robinhoodLogo} alt='' aria-hidden='true'/>Robinhood Chain</span>
</span></p>}
// First-screen geometry lives in the adjacent cached stylesheet.
