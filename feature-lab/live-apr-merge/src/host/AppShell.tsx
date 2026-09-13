import { lazy, Suspense, useState, useEffect, type ReactNode } from 'react'
import styled, { css, ThemeProvider } from 'styled-components'
import { Link, useLocation } from 'react-router-dom'
import type { Address } from 'viem'
import { ensureChain } from '@lab/wallet/wallet'
import { robinhoodChain } from '@lab/chain/chains'
import { Sidebar } from './Sidebar'
import { MobileHomeNavigation, mobileHomeMaxWidth } from './MobileHomeNavigation'
import { sidebarDestinations } from './sidebarNavigation'
import { AprNavigationLabel } from './aprTextStyle'
import { sidebarCollapsedWidth, sidebarMobileWidth } from './sidebarTheme'
import { darkTheme, GlobalStyles, Modal, NAV_BUTTON_CHROME, ICON_BUTTON_HOVER } from './ui'
import { HeaderDialog, HeaderIcon, CloseButton } from './HeaderDialogs'
import { Emblem3DLogo } from '@fixed/shared/components/emblem3d/Emblem3DLogo'
import './fonts.css'

const mount = import.meta.env.BASE_URL
const RowTweaks = import.meta.env.VITE_DEV_TWEAKS === 'true' ? lazy(() => import('../dev/RowTweaks')) : null

/** One live shell across routes. The prototype contributes appearance only:
 * the connected address and network-switch approval come from a real wallet. */
export function AppShell({ account, chainId, onConnect, children, overlays, liveApr = false, pageLabel = 'Home' }: {
  account: Address | null; chainId?: number; onConnect: () => void; children: ReactNode;
  overlays?: ReactNode; liveApr?: boolean; pageLabel?: string;
}) {
  const path = useLocation().pathname
  const mobileHome = true
  const labHref = import.meta.env.VITE_FEATURE_LAB_HREF
  const [menu, setMenu] = useState(false), [network, setNetwork] = useState(false)
  const [switching, setSwitching] = useState(false), [networkError, setNetworkError] = useState('')
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  useEffect(() => { setMenu(false); setNetwork(false) }, [path])
  // Do not offer fictional campaign-network support. Selecting the supported
  // chain requests an actual wallet switch, with rejection shown in the sheet.
  async function selectNetwork() {
    if (!account) { setNetwork(false); onConnect(); return }
    setSwitching(true); setNetworkError('')
    try { await ensureChain(robinhoodChain); setNetwork(false) }
    catch (error) { setNetworkError((error instanceof Error ? error.message : 'Could not switch wallet network.').split('\n')[0].slice(0,180)) }
    finally { setSwitching(false) }
  }
  const destinations = sidebarDestinations('/')
  const menuLink = (item: {label:string;href:string;external?:boolean}) => <MenuLink key={item.href} to={item.href}
    aria-current={!item.external && path === item.href ? 'page' : undefined}
    target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}
    onClick={() => setMenu(false)}>
    <span>{item.label === 'Live APR' ? <AprNavigationLabel>Live APR</AprNavigationLabel> : item.label}</span>
    {item.external && <span aria-hidden='true'>↗</span>}
  </MenuLink>
  return <ThemeProvider theme={darkTheme}>
    <GlobalStyles />
    {RowTweaks && <DesktopTweaks $mobileHome={mobileHome}><Suspense fallback={null}><RowTweaks /></Suspense></DesktopTweaks>}
    <Frame $sidebarCollapsed={sidebarCollapsed} $mobileHome={mobileHome} data-mobile-home data-home-page={path === '/' || undefined}>
      <Sidebar home='/' collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(value => !value)} />
      <Content>
        <Nav aria-label='Account controls'>
          {/* Share the existing lazy 3D emblem and home navigation; the mobile
              cutoff matches the bottom navigation rather than a second layout. */}
          <MobileBrand to='/' aria-label='Saffron home' data-mobile-header-logo><Emblem3DLogo spinSpeed={0.25}/></MobileBrand>
          <Breadcrumb aria-label='Breadcrumb'><Link to='/'>Saffron</Link><span aria-hidden='true'>/</span><span aria-current='page' title={pageLabel}>{pageLabel}</span></Breadcrumb>
          <Controls>
            <Connect $connected={Boolean(account)} aria-label={account ? 'Manage wallet' : 'Connect wallet'} aria-haspopup='dialog' onClick={() => {setMenu(false);setNetwork(false);onConnect()}}>
              {account ? <><WalletDot />{account.slice(0,6)}…{account.slice(-4)}</> : <><LongLabel>Connect wallet</LongLabel><ShortLabel>Connect</ShortLabel></>}
            </Connect>
            <Chain aria-label='Select network' title='Robinhood Chain' aria-haspopup='dialog' aria-expanded={network} onClick={() => {setMenu(false);setNetworkError('');setNetwork(true)}}>
              <img src={`${mount}robinhood.svg`} width='21' height='21' alt='' /><ChainName>Robinhood</ChainName><HeaderIcon name='chevron'/>
            </Chain>
            <MenuButton aria-label='Open menu' aria-haspopup='dialog' aria-expanded={menu} onClick={() => {setNetwork(false);setMenu(true)}}><HeaderIcon name='menu'/></MenuButton>
          </Controls>
        </Nav>
        <Body id='main-content' tabIndex={-1} aria-label={pageLabel}>{children}</Body>
        <Footer>{labHref && <a href={labHref}>Saffron Feature Lab</a>}{liveApr && <p>Live onchain pool data · read-only</p>}<a href={`${mount}install.html`}>Source & installation</a></Footer>
      </Content>
      <MobileHomeNavigation onMore={() => {setNetwork(false);setMenu(true)}} menuOpen={menu} />
    </Frame>
    {overlays}
    {menu && <HeaderDialog title='Saffron' menu onClose={() => setMenu(false)}>
      <MenuGroup aria-label='Explore'><GroupLabel>Explore</GroupLabel>{destinations.filter(item => !['Administration','Status','Journey Guide'].includes(item.label)).map(menuLink)}</MenuGroup>
      <MenuGroup aria-label='Operator workspace'><GroupLabel>Operator workspace</GroupLabel>{menuLink({label:'Campaigns',href:'/campaigns'})}{destinations.filter(item => ['Administration','Status','Journey Guide'].includes(item.label)).map(menuLink)}</MenuGroup>
      <MenuGroup aria-label='Resources'><GroupLabel>Resources</GroupLabel><ResourceLink href={`${mount}install.html`}>Source & installation<span aria-hidden='true'>↗</span></ResourceLink>{labHref && <ResourceLink href={labHref}>Feature Lab<span aria-hidden='true'>↗</span></ResourceLink>}</MenuGroup>
    </HeaderDialog>}
    {network && <Modal isOpen contentLabel='Select network' overlayStyle={{backgroundColor:'transparent'}} onRequestClose={() => setNetwork(false)} shouldCloseOnOverlayClick={!switching}
      contentStyle={{width:'min(280px, calc(100vw - 24px))',left:'auto',right:12,top:64,transform:'none',padding:9,background:'#0b090c',border:'1px solid #45334d',borderRadius:9,boxShadow:'0 22px 75px #000b'}}>
      <NetworkHeading><h2>Select network</h2><CloseButton aria-label='Close network selector' onClick={() => setNetwork(false)}><HeaderIcon name='close'/></CloseButton></NetworkHeading>
      <NetworkOption disabled={switching} onClick={() => void selectNetwork()} aria-label={account && chainId !== 4663 ? 'Switch wallet to Robinhood' : 'Select Robinhood'}>
        <img src={`${mount}robinhood.svg`} alt=''/><span>Robinhood<small>Chain 4663 · available</small></span><Check aria-hidden='true'>✓</Check>
      </NetworkOption>
      <NetworkOption disabled><img src={`${mount}eth.svg`} alt=''/><span>Ethereum<small>Not supported on this app</small></span></NetworkOption>
      <NetworkOption disabled><NetworkMonogram>Arb</NetworkMonogram><span>Arbitrum<small>Not supported on this app</small></span></NetworkOption>
      <NetworkNote role={networkError ? 'alert' : 'status'}>{networkError || (switching ? 'Approve the network switch in your wallet…' : !account ? 'Connect a wallet to use Robinhood.' : chainId === 4663 ? 'Your wallet is on Robinhood.' : chainId === undefined ? 'Checking your wallet network. Select Robinhood to verify.' : 'Your wallet is on another network. Select Robinhood to switch.')}</NetworkNote>
    </Modal>}
  </ThemeProvider>
}

const Frame = styled.div<{ $sidebarCollapsed: boolean; $mobileHome: boolean }>`
  min-height:100vh;color:${p => p.theme.colors.text.primary};display:grid;grid-template-columns:252px minmax(0,1fr);align-items:start;overflow:clip;
  &[data-home-page] #main-content button{border-radius:24px;}
  @media(max-width:1100px){grid-template-columns:220px minmax(0,1fr);}
  @media(max-width:${sidebarMobileWidth}px){grid-template-columns:minmax(0,1fr);}
  ${p => p.$sidebarCollapsed ? `&&{grid-template-columns:${sidebarCollapsedWidth}px minmax(0,1fr);}` : ''}
  ${p => p.$mobileHome && css`@media(max-width:${mobileHomeMaxWidth}px){
    &&{grid-template-columns:minmax(0,1fr);background:#000;}
    > [data-saffron-sidebar]{display:none;}
    #main-content{max-width:none;flex:none;padding:22px max(16px,env(safe-area-inset-right,0px)) calc(24px + 78px + env(safe-area-inset-bottom,0px)) max(16px,env(safe-area-inset-left,0px));}
    footer{display:none;}
  }@media(max-width:345px){#main-content{padding-left:12px;padding-right:12px;padding-top:18px;}}`}
`
const DesktopTweaks = styled.div<{ $mobileHome: boolean }>`${p => p.$mobileHome && css`@media(max-width:${mobileHomeMaxWidth}px){display:none;}`}`
const Content = styled.div`min-width:0;min-height:100vh;display:flex;flex-direction:column;`
const Nav = styled.header`height:73px;width:100%;padding:0 28px 0 32px;display:flex;align-items:center;justify-content:space-between;gap:20px;border-bottom:1px solid #1a1717;background:#000;flex:none;margin-bottom:24px;@media(max-width:1100px){padding:0 24px;}@media(max-width:800px){height:65px;padding:0 16px;gap:12px;}@media(max-width:540px){padding:0 12px;gap:8px;margin-bottom:0;}@media(max-width:360px){padding:0 10px;gap:6px;}`
const MobileBrand = styled(Link)`display:none;width:44px;height:44px;flex:none;border-radius:6px;&:focus-visible{outline:2px solid #d286ff;outline-offset:3px;}@media(max-width:${mobileHomeMaxWidth}px){display:block;}`
const Breadcrumb = styled.nav`display:flex;align-items:center;gap:12px;min-width:0;font:400 12px 'Host Grotesk',sans-serif;white-space:nowrap;color:#9b9490;a{color:inherit;flex:none;&:hover{color:#fff;}&:focus-visible{outline:2px solid #d286ff;outline-offset:4px;}}>[aria-hidden]{color:#675c57;}[aria-current]{color:#e7e1df;overflow:hidden;text-overflow:ellipsis;}@media(max-width:${mobileHomeMaxWidth}px){display:none;}`
const Controls = styled.div`display:flex;align-items:center;gap:12px;flex:none;margin-left:auto;@media(max-width:800px){gap:8px;}@media(max-width:540px){gap:6px;}@media(max-width:360px){gap:5px;}`
const headerControl = css`display:inline-flex;align-items:center;justify-content:center;gap:9px;height:40px;border:1px solid #30272f;border-radius:6px;background:#0a0909;color:#f7f5f4;cursor:pointer;box-sizing:border-box;white-space:nowrap;text-transform:none;font:500 13px 'Funnel Display',sans-serif;transition:background .15s,border-color .15s;&:hover,&[aria-expanded=true]{border-color:#80568e;background:#16101b;}&:focus-visible{outline:2px solid #d286ff;outline-offset:3px;}@media(max-width:800px){height:44px;}@media(prefers-reduced-motion:reduce){transition:none;}`
const Connect = styled.button<{$connected:boolean}>`${headerControl}min-width:128px;padding:0 14px;${p=>p.$connected && css`font:400 11px 'Roboto Mono',monospace;`}@media(max-width:540px){min-width:0;padding:0 10px;gap:5px;font-size:${p=>p.$connected?'10px':'12px'};}@media(max-width:360px){padding:0 8px;font-size:${p=>p.$connected?'9px':'11px'};}`
const WalletDot=styled.span`width:5px;height:5px;border-radius:50%;background:#83dca0;flex:none;@media(max-width:360px){display:none;}`
const LongLabel=styled.span`@media(max-width:540px){display:none;}`
const ShortLabel=styled.span`display:none;@media(max-width:540px){display:inline;}`
const Chain=styled.button`${headerControl}padding:0 11px;font:400 12px 'Host Grotesk',sans-serif;gap:8px;img{object-fit:contain;}svg{width:11px;height:11px;}@media(max-width:800px){width:44px;padding:0;gap:0;svg{display:none;}}`
const ChainName=styled.span`@media(max-width:800px){display:none;}`
const MenuButton=styled.button`${headerControl}width:40px;padding:0;@media(max-width:800px){width:44px;}`
const Body=styled.main`min-width:0;outline:none;width:100%;max-width:var(--page-max-width);padding:0 var(--page-padding-x);margin:0 auto;flex:1;`
const Footer=styled.footer`padding:40px 20px 24px;text-align:center;font-size:12px;color:${p=>p.theme.colors.text.tertiary};a{display:block;color:inherit;}a+a{margin-top:12px;}`
const MenuGroup=styled.nav`display:flex;flex-direction:column;gap:2px;&+&{border-top:1px solid #352a32;padding-top:15px;margin-top:2px;}`
const GroupLabel=styled.h3`font:400 10px 'Roboto Mono',monospace;letter-spacing:.08em;text-transform:uppercase;color:#a59aa5;margin:0 12px 8px;`
const menuRow=css`display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:44px;padding:10px 12px;border:1px solid transparent;border-radius:8px;text-decoration:none;color:#d5cbd5;font:400 14px 'Host Grotesk',sans-serif;&:hover{background:#171016;border-color:#49334f;}&[aria-current=page]{background:#211427;border-color:#654570;color:#efd8ff;}&:focus-visible{outline:2px solid #d286ff;outline-offset:2px;}>span[aria-hidden='true']{color:#ab89bb;}`
const MenuLink=styled(Link)`${menuRow}`
const ResourceLink=styled.a`${menuRow}`
const NetworkHeading=styled.div`display:flex;justify-content:space-between;align-items:center;padding:2px 5px 8px 10px;h2{font:400 12px 'Host Grotesk',sans-serif;color:#b4a4bb;margin:0;}`
const NetworkOption=styled.button`display:flex;align-items:center;gap:11px;width:100%;padding:10px 12px;min-height:56px;border:1px solid transparent;border-radius:24px;background:transparent;color:#e3d3eb;cursor:pointer;text-align:left;font:400 14px 'Funnel Display',sans-serif;img{width:26px;height:26px;object-fit:contain;}small{display:block;font:400 10px/1.5 'Host Grotesk',sans-serif;color:#aaa0af;margin-top:3px;}&:hover:not(:disabled){background:#211427;border-color:#6c497a;}&:focus-visible{outline:2px solid #d286ff;outline-offset:2px;}&:disabled{opacity:.45;cursor:not-allowed;}`
const NetworkMonogram=styled.span`width:26px;height:26px;border:1px solid #405473;background:#152131;display:grid;place-items:center;flex:none;font:10px 'Roboto Mono',monospace;color:#b5cbf6;border-radius:50%;`
const Check=styled.span`margin-left:auto;color:#d286ff;`
const NetworkNote=styled.p`padding:8px 12px 6px;margin:0;font:400 11px/1.6 'Host Grotesk',sans-serif;color:#a99aaf;&[role=alert]{color:#ffada6;}`
// Keep the legacy named exports for the standalone entry point's imports.
export const WalletList=styled.div`display:flex;flex-direction:column;gap:12px;p{font-size:14px;line-height:1.5;}`
export const WalletButton=styled.button`${NAV_BUTTON_CHROME}${ICON_BUTTON_HOVER}border-radius:24px;height:44px;color:${p=>p.theme.colors.text.primary};cursor:pointer;&:disabled{opacity:.5;cursor:default;}`
