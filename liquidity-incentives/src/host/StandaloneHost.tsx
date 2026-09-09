import { lazy, Suspense, useState } from 'react'
import styled, { ThemeProvider } from 'styled-components'
import { useWallet } from '@lab/hooks/useWallet'
import IncentivesPage from '../incentives/IncentivesPage'
import { Sidebar } from './Sidebar'
import { sidebarCollapsedWidth, sidebarMobileWidth } from './sidebarTheme'
import { darkTheme, lightTheme, GlobalStyles, Modal, ModalTitle, NAV_BUTTON_CHROME, NAV_SQUARE_BUTTON, ICON_BUTTON_HOVER } from './ui'

const mount = import.meta.env.BASE_URL
// Only the review build opts into this disposable chunk. A normal build drops
// the import and all tweak controls/storage; src/incentives never imports dev.
const RowTweaks = import.meta.env.VITE_DEV_TWEAKS === 'true'
  ? lazy(() => import('../dev/RowTweaks')) : null

/** Disposable preview shell: the merge uses fixed-income's existing navbar,
 * wallet providers and theme owner. The feature receives only account/connect.
 * Reuse LiqiFi's tested EIP-6963 manager here, not a second wallet implementation.
 */
export function StandaloneHost() {
  const wallet = useWallet()
  const [light, setLight] = useState(false)
  const [menu, setMenu] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  return <ThemeProvider theme={light ? lightTheme : darkTheme}>
    <GlobalStyles />
    {RowTweaks && <Suspense fallback={null}><RowTweaks /></Suspense>}
    <Frame $sidebarCollapsed={sidebarCollapsed}>
      <Sidebar home={mount} collapsed={sidebarCollapsed} onToggle={() => setSidebarCollapsed(value => !value)} />
      <Content>
      <Nav aria-label='Account controls'>
        <Controls>
          <Connect aria-label={wallet.account ? 'Manage wallet' : 'Connect wallet'} onClick={wallet.openModal}>
            {wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : 'Connect'}
          </Connect>
          <Chain aria-label='Requested network: Robinhood' title='Incentive vaults on Robinhood'><img src={`${mount}robinhood.svg`} width='20' height='20' alt='' /></Chain>
          <MenuButton aria-label='Open menu' onClick={() => setMenu(true)}>☰</MenuButton>
        </Controls>
      </Nav>
      <Body id='main-content'><IncentivesPage account={wallet.account} onConnect={wallet.openModal} /></Body>
      <Footer><a href={mount}>Saffron Feature Lab</a></Footer>
      </Content>
    </Frame>
    {/* Explicit layering keeps wallet selection above existing form portals. */}
    {wallet.modalOpen && <Modal isOpen layer='wallet' onRequestClose={wallet.closeModal} shouldCloseOnOverlayClick={!wallet.connecting}>
      <ModalTitle>Connect wallet</ModalTitle>
      <WalletList>
        {wallet.providers.map(provider => <WalletButton key={provider.id} disabled={wallet.connecting}
          onClick={() => void wallet.connectProvider(provider.id)}>{provider.name}{wallet.connectingProviderId === provider.id ? ', connecting…' : ''}</WalletButton>)}
        {!wallet.available && <p>Open this page in your wallet browser or enable a browser wallet extension.</p>}
        {wallet.error && <p role='alert'>{wallet.error}</p>}
        <WalletButton disabled={wallet.connecting} onClick={wallet.refreshProviders}>Refresh wallets</WalletButton>
        {wallet.account && <WalletButton onClick={wallet.disconnect}>Disconnect wallet</WalletButton>}
        <WalletButton disabled={wallet.connecting} onClick={wallet.closeModal}>Close</WalletButton>
      </WalletList>
    </Modal>}
    <Modal isOpen={menu} onRequestClose={() => setMenu(false)}>
      <ModalTitle>Saffron</ModalTitle>
      <WalletList>
        <NavLink href={mount + 'portfolio/requests'} onClick={() => setMenu(false)}>My requests</NavLink>
        <NavLink href={mount + 'admin/requests'} onClick={() => setMenu(false)}>Admin queue</NavLink>
        <NavLink href={mount}>Feature Lab</NavLink>
        <WalletButton onClick={() => setLight(value => !value)}>{light ? 'Dark' : 'Light'} theme</WalletButton>
        <WalletButton onClick={() => setMenu(false)}>Close</WalletButton>
      </WalletList>
    </Modal>
  </ThemeProvider>
}

// The shell owns navigation only. A wider mobile cutoff leaves enough room for
// the feature's existing five-column vault rows without altering their layout.
const Frame = styled.div<{ $sidebarCollapsed: boolean }>`
  min-height:100vh;color:${p => p.theme.colors.text.primary};display:grid;grid-template-columns:252px minmax(0,1fr);align-items:start;
  @media(max-width:1100px){grid-template-columns:220px minmax(0,1fr);}
  @media(max-width:${sidebarMobileWidth}px){grid-template-columns:minmax(0,1fr);}
  ${p => p.$sidebarCollapsed ? `&&{grid-template-columns:${sidebarCollapsedWidth}px minmax(0,1fr);}` : ''}
`
const Content = styled.div`min-width:0;min-height:100vh;display:flex;flex-direction:column;`
const Nav = styled.header`display:flex;align-items:center;gap:12px;width:100%;max-width:var(--page-max-width);padding:var(--page-padding-x);margin:0 auto;`
const NavLink = styled.a<{ $active?: boolean }>`padding:0 20px;height:44px;font-size:13px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;display:flex;align-items:center;white-space:nowrap;color:${p => p.$active ? p.theme.colors.text.primary : p.theme.colors.text.tertiary};&:hover{color:${p => p.theme.colors.text.primary}}`
const Controls = styled.div`display:flex;align-items:center;gap:12px;margin-left:auto;`
const Connect = styled.button`${NAV_BUTTON_CHROME}${ICON_BUTTON_HOVER}border-color:transparent;min-width:110px;padding:0 18px;color:${p => p.theme.colors.text.primary};font:500 14px ${p => p.theme.fonts.mono};letter-spacing:.06em;text-transform:uppercase;cursor:pointer;`
const Chain = styled.div`${NAV_SQUARE_BUTTON}border-color:transparent;display:grid;place-items:center;`
const MenuButton = styled.button`${NAV_SQUARE_BUTTON}background:${p => p.theme.colors.primary.saffron};border:none;color:white;font-size:20px;cursor:pointer;`
const Body = styled.main`width:100%;max-width:var(--page-max-width);padding:0 var(--page-padding-x);margin:0 auto;flex:1;`
const Footer = styled.footer`padding:40px 20px 24px;text-align:center;font-size:12px;a{color:${p => p.theme.colors.text.tertiary}}`
const WalletList = styled.div`display:flex;flex-direction:column;gap:12px;p{font-size:14px;line-height:1.5}`
const WalletButton = styled.button`${NAV_BUTTON_CHROME}${ICON_BUTTON_HOVER}border-color:transparent;height:44px;color:${p => p.theme.colors.text.primary};cursor:pointer;&:disabled{opacity:.5;cursor:default}`
