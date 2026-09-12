import styled from 'styled-components'
import { Link, useLocation } from 'react-router-dom'

// One cutoff for the public journey, cards and preview controls.
export const mobileHomeMaxWidth = 599

const paths = {
  Home: 'M3 10l9-7 9 7v11h-6v-7H9v7H3z',
  Portfolio: 'M4 5h16v15H4z M8 5V3h8v2 M8 11h8 M8 16h8',
  'Live APR': 'M3 19l6-7 4 3 7-11 M14 4h6v6',
  More: 'M5 6h14 M5 12h14 M5 18h14',
}

/** Real router links retain the current session and backend state. More opens
 * the existing accessible menu, not a prototype route or a new state store. */
export function MobileHomeNavigation({ onMore, menuOpen }: { onMore: () => void; menuOpen: boolean }) {
  const path=useLocation().pathname.replace(/\/+$/,'')||'/'
  return <Navigation aria-label='Mobile navigation' data-mobile-home-nav>
    {([['Home', '/'], ['Portfolio', '/portfolio/vaults'], ['Live APR', '/live-apr']] as const).map(([name, to]) =>
      <Item key={name} to={to} aria-current={path===to||(to!=='/'&&path.startsWith(to+'/')) ? 'page' : undefined} data-live-apr={name === 'Live APR' || undefined}>
        <svg viewBox='0 0 24 24' aria-hidden='true'><path d={paths[name]} /></svg><span>{name}</span>
      </Item>)}
    <Item as='button' type='button' onClick={onMore} aria-haspopup='dialog' aria-expanded={menuOpen}>
      <svg viewBox='0 0 24 24' aria-hidden='true'><path d={paths.More} /></svg><span>More</span>
    </Item>
  </Navigation>
}

const Navigation = styled.nav`
  display:none;
  @media(max-width:${mobileHomeMaxWidth}px){
    position:fixed;z-index:4;bottom:0;left:0;right:0;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:4px;
    height:calc(78px + env(safe-area-inset-bottom,0px));padding:7px max(8px,env(safe-area-inset-right,0px)) calc(16px + env(safe-area-inset-bottom,0px)) max(8px,env(safe-area-inset-left,0px));
    background:#070608;border-top:1px solid #242027;
  }
`
const Item = styled(Link)`
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:3px;min-height:54px;min-width:0;
  padding:4px;border:1px solid transparent;border-radius:10px;background:transparent;color:#aaa3b0;
  font:400 11px/1.45 "Funnel Display",sans-serif;text-decoration:none;cursor:pointer;touch-action:manipulation;
  svg{width:21px;height:21px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linejoin:round;stroke-linecap:round;}
  &[data-live-apr]{color:#ffbc09;}
  &[aria-current=page]{color:#fff;border-color:#d286ff80;box-shadow:0 0 20px #c875ff12;
    background:radial-gradient(110% 180% at 0% 100%,#d286ffb3,#9a29b8b3 38%,transparent 75%),linear-gradient(150deg,#130d1c,#c875ffb3);}
  &:focus-visible{outline:2px solid #d286ff;outline-offset:2px;}
`
