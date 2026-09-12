import { lazy, Suspense, useState, useEffect, type ReactNode } from 'react'
import styled, { css, ThemeProvider } from 'styled-components'
import { Link, useLocation } from 'react-router-dom'
import type { Address } from 'viem'
import { Sidebar } from './Sidebar'
import { MobileHomeNavigation, mobileHomeMaxWidth } from './MobileHomeNavigation'
import { sidebarDestinations } from './sidebarNavigation'
import { AprNavigationLabel } from './aprTextStyle'
import { rowSurface } from './rowSurface'
import { sidebarCollapsedWidth, sidebarMobileWidth } from './sidebarTheme'
import { darkTheme, GlobalStyles, Modal, ModalTitle, NAV_BUTTON_CHROME, ICON_BUTTON_HOVER } from './ui'
import './fonts.css'

const mount = import.meta.env.BASE_URL
const RowTweaks = import.meta.env.VITE_DEV_TWEAKS === 'true'
  ? lazy(() => import('../dev/RowTweaks')) : null

/** One approved navigation/theme shell for every page and both entry points.
 * Wallet custody stays with the caller; all entries use actual wallet providers.
 * Extra menu controls and overlays remain inside the same theme/modal owner. */
export function AppShell({ account, onConnect, children, overlays, liveApr = false, pageLabel = 'Home' }: {
  account: Address | null; onConnect: () => void; children: ReactNode;
  overlays?: ReactNode; liveApr?: boolean;
  pageLabel?: string;
}) {
  const path = useLocation().pathname
  const mobileHome = true
  // Menus close on navigation; sidebar state belongs to this stable dark shell.
  useEffect(() => setMenu(false), [path])
  const labHref = import.meta.env.VITE_FEATURE_LAB_HREF
  const [menu, setMenu] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  return <ThemeProvider theme={darkTheme}>
    <GlobalStyles />
    {RowTweaks && <DesktopTweaks $mobileHome={mobileHome}><Suspense fallback={null}><RowTweaks /></Suspense></DesktopTweaks>}
    <Frame $sidebarCollapsed={sidebarCollapsed} $mobileHome={mobileHome} data-mobile-home={mobileHome || undefined}>
      <Sidebar home='/' collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(value => !value)} />
      <Content>
        <Nav aria-label='Account controls'><MobileBrand to='/' aria-label='Saffron home'><img src={`${mount}emblem.png`} alt='' />SAFFRON</MobileBrand><Controls>
          <Connect aria-label={account ? 'Manage wallet' : 'Connect wallet'} onClick={onConnect}>
            {account ? `${account.slice(0, 6)}…${account.slice(-4)}` : 'Connect'}
          </Connect>
          <Chain aria-label='Network: Robinhood' title='Robinhood Chain'><img src={`${mount}robinhood.svg`} width='20' height='20' alt='' /></Chain>
          <MenuButton aria-label='Open menu' onClick={() => setMenu(true)}>☰</MenuButton>
        </Controls></Nav>
        <Body id='main-content' tabIndex={-1} aria-label={pageLabel}>{children}</Body>
        <Footer>{labHref && <a href={labHref}>Saffron Feature Lab</a>}{liveApr && <p>Live onchain pool data · read-only</p>}<a href={`${mount}install.html`}>Source & installation</a></Footer>
      </Content>
      {mobileHome && <MobileHomeNavigation onMore={() => setMenu(true)} menuOpen={menu} />}
    </Frame>
    {overlays}
    <Modal isOpen={menu} onRequestClose={() => setMenu(false)}>
      <ModalTitle>Saffron</ModalTitle>
      <WalletList>
        <NavLink to='/'>Home</NavLink>
        <NavLink to='/campaigns'>Campaigns</NavLink>
        <NavLink to='/admin'>Administration</NavLink>
        <NavLink to='/status'>Status</NavLink>
        <NavLink to='/journey'>Journey Guide</NavLink>
        <NavLink to='/live-apr'><AprNavigationLabel>Live APR</AprNavigationLabel></NavLink>
        {mobileHome && <MobileMenuExtras>
          {sidebarDestinations('/').filter(item => !['Home', 'Live APR', 'Administration', 'Status', 'Journey Guide'].includes(item.label)).map(item =>
            <NavLink key={item.href} to={item.href} target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>{item.label}</NavLink>)}
          <NavLink as='a' href={`${mount}install.html`}>Source & installation</NavLink>
        </MobileMenuExtras>}
        {/* This destination is outside the router's mount, so use a native link. */}
        {labHref && <NavLink as='a' href={labHref}>Feature Lab</NavLink>}
        <WalletButton onClick={() => setMenu(false)}>Close</WalletButton>
      </WalletList>
    </Modal>
  </ThemeProvider>
}

// The shell owns navigation only. A wider mobile cutoff leaves enough room for
// the feature's existing five-column vault rows without altering their layout.
const Frame = styled.div<{ $sidebarCollapsed: boolean; $mobileHome: boolean }>`
  min-height:100vh;color:${p => p.theme.colors.text.primary};display:grid;grid-template-columns:252px minmax(0,1fr);align-items:start;
  /* Clip offscreen sidebar paint without creating a nested scroll container.
     Its vertical growth must not lengthen the document on hover. */
  overflow:clip;
  @media(max-width:1100px){grid-template-columns:220px minmax(0,1fr);}
  @media(max-width:${sidebarMobileWidth}px){grid-template-columns:minmax(0,1fr);}
  ${p => p.$sidebarCollapsed ? `&&{grid-template-columns:${sidebarCollapsedWidth}px minmax(0,1fr);}` : ''}
  /* Every phone destination shares the approved compact navigation. Keep the
     desktop sidebar mounted so resizing preserves its collapse state. */
  ${p => p.$mobileHome && css`@media(max-width:${mobileHomeMaxWidth}px){
    &&{grid-template-columns:minmax(0,1fr);background:#000;}
    > [data-saffron-sidebar]{display:none;}
    header[aria-label='Account controls']{height:60px;max-width:none;padding:8px max(16px,env(safe-area-inset-right,0px)) 8px max(16px,env(safe-area-inset-left,0px));background:#050505;border-bottom:1px solid #171717;}
    [data-mobile-brand]{display:flex;}
    header[aria-label='Account controls'] button{height:44px;min-width:86px;padding:8px 12px;border:1px solid #262329;border-radius:10px;letter-spacing:.03em;font-size:12px;font-weight:400;}
    header[aria-label='Account controls'] div[aria-label='Network: Robinhood'],header[aria-label='Account controls'] button[aria-label='Open menu']{display:none;}
    #main-content{max-width:none;flex:none;padding:22px max(16px,env(safe-area-inset-right,0px)) calc(24px + 78px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));}
    footer{display:none;}
  }@media(max-width:345px){#main-content{padding-left:12px;padding-right:12px;padding-top:18px;}}
  `}
`
const MobileBrand = styled(Link).attrs({ 'data-mobile-brand': '' })`
  display:none;align-items:center;gap:7px;color:#f2f0ea;min-height:44px;
  font:600 13px/1.45 "Funnel Display",sans-serif;letter-spacing:.12em;text-decoration:none;
  img{width:28px;height:32px;object-fit:contain;}
  &:focus-visible{outline:2px solid #d286ff;outline-offset:2px;}
`
const MobileMenuExtras = styled.div`display:none;@media(max-width:${mobileHomeMaxWidth}px){display:flex;flex-direction:column;gap:12px;}`
// The floating desktop styling panel must not cover the approved bottom bar.
const DesktopTweaks = styled.div<{ $mobileHome: boolean }>`${p => p.$mobileHome && css`@media(max-width:${mobileHomeMaxWidth}px){display:none;}`}`
const Content = styled.div`min-width:0;min-height:100vh;display:flex;flex-direction:column;`
const Nav = styled.header`display:flex;align-items:center;gap:12px;width:100%;max-width:var(--page-max-width);padding:var(--page-padding-x);margin:0 auto;`
const NavLink = styled(Link)<{ $active?: boolean }>`padding:0 20px;height:44px;font-size:13px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;display:flex;align-items:center;white-space:nowrap;color:${p => p.$active ? p.theme.colors.text.primary : p.theme.colors.text.tertiary};&:hover{color:${p => p.theme.colors.text.primary}}`
const Controls = styled.div`display:flex;align-items:center;gap:12px;margin-left:auto;`
// Match the vault rows without inheriting the old red header hover/fill.
// Keep the network indicator's existing read-only behavior and control sizes.
const headerControlSurface = css`${rowSurface}height:40px;box-sizing:border-box;`
const Connect = styled.button`${headerControlSurface}min-width:110px;padding:0 18px;color:${p => p.theme.colors.text.primary};font:500 14px "Funnel Display",ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;cursor:pointer;`
const Chain = styled.div`${headerControlSurface}width:40px;flex:none;display:grid;place-items:center;`
const MenuButton = styled.button`${headerControlSurface}width:40px;flex:none;color:white;font-size:20px;cursor:pointer;`
const Body = styled.main`min-width:0;outline:none;width:100%;max-width:var(--page-max-width);padding:0 var(--page-padding-x);margin:0 auto;flex:1;`
const Footer = styled.footer`padding:40px 20px 24px;text-align:center;font-size:12px;color:${p => p.theme.colors.text.tertiary};a{display:block;color:${p => p.theme.colors.text.tertiary}}a+a{margin-top:12px}`
export const WalletList = styled.div`display:flex;flex-direction:column;gap:12px;p{font-size:14px;line-height:1.5}`
export const WalletButton = styled.button`${NAV_BUTTON_CHROME}${ICON_BUTTON_HOVER}border-color:transparent;height:44px;color:${p => p.theme.colors.text.primary};cursor:pointer;&:disabled{opacity:.5;cursor:default}`
