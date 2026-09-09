import { lazy, Suspense, useState } from 'react'
import styled, { ThemeProvider } from 'styled-components'
import { useWallet } from '@lab/hooks/useWallet'
import IncentivesPage from '../incentives/IncentivesPage'
import { Emblem3DLogo } from '@fixed/shared/components/emblem3d/Emblem3DLogo'
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
  return <ThemeProvider theme={light ? lightTheme : darkTheme}>
    <GlobalStyles />
    {RowTweaks && <Suspense fallback={null}><RowTweaks /></Suspense>}
    <Frame>
      <Nav aria-label='Main navigation'>
        <LogoLink href={mount} aria-label='Saffron'><Emblem3DLogo /></LogoLink>
        <Tabs>
          <NavLink href={mount} $active>Explore⌄</NavLink>
          <NavLink href={mount + 'portfolio/requests'}>Portfolio</NavLink>
          <NavLink href={mount + 'admin/requests'}>Admin queue</NavLink>
          <NavLink href='https://docs.saffron.finance/security/audits' target='_blank' rel='noreferrer'>Audits</NavLink>
        </Tabs>
        <Controls>
          <Connect aria-label={wallet.account ? 'Manage wallet' : 'Connect wallet'} onClick={wallet.openModal}>
            {wallet.account ? `${wallet.account.slice(0, 6)}…${wallet.account.slice(-4)}` : 'Connect'}
          </Connect>
          <Chain aria-label='Requested network: Robinhood' title='Incentive vaults on Robinhood'><img src={`${mount}robinhood.svg`} width='20' height='20' alt='' /></Chain>
          <MenuButton aria-label='Open menu' onClick={() => setMenu(true)}>☰</MenuButton>
        </Controls>
      </Nav>
      <Body><IncentivesPage account={wallet.account} onConnect={wallet.openModal} /></Body>
      <Footer><a href={mount}>Saffron Feature Lab</a></Footer>
      <Bottom aria-label='Mobile navigation'>
        <a href={mount}>Explore</a><a href={mount + 'portfolio/requests'}>Portfolio</a>
        <button onClick={() => setMenu(true)}>Menu</button>
      </Bottom>
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
        <NavLink href={mount}>Feature Lab</NavLink>
        <WalletButton onClick={() => setLight(value => !value)}>{light ? 'Dark' : 'Light'} theme</WalletButton>
        <WalletButton onClick={() => setMenu(false)}>Close</WalletButton>
      </WalletList>
    </Modal>
  </ThemeProvider>
}

// Navbar layout follows fixed-income NavBar.tsx; its protocol-aware component
// itself stays upstream (orders, stars, JWT, router and account menu included).
const Frame = styled.div`min-height:100vh;color:${p => p.theme.colors.text.primary};display:flex;flex-direction:column;`
const Nav = styled.nav`display:flex;align-items:center;gap:12px;width:100%;max-width:var(--page-max-width);padding:var(--page-padding-x);margin:0 auto;`
// Match beta's LogoContainer dimensions and hover; one renderer at every width.
const LogoLink = styled.a`display:flex;align-items:center;flex-shrink:0;cursor:pointer;width:44px;height:44px;transition:opacity .2s ease;&:hover{opacity:.8}`
const Tabs = styled.div`display:flex;gap:4px;align-items:center;@media(max-width:1300px){display:none}`
const NavLink = styled.a<{ $active?: boolean }>`padding:0 20px;height:44px;font-size:13px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;display:flex;align-items:center;white-space:nowrap;color:${p => p.$active ? p.theme.colors.text.primary : p.theme.colors.text.tertiary};&:hover{color:${p => p.theme.colors.text.primary}}`
const Controls = styled.div`display:flex;align-items:center;gap:12px;margin-left:auto;`
const Connect = styled.button`${NAV_BUTTON_CHROME}${ICON_BUTTON_HOVER}border-color:transparent;min-width:110px;padding:0 18px;color:${p => p.theme.colors.text.primary};font:500 14px ${p => p.theme.fonts.mono};letter-spacing:.06em;text-transform:uppercase;cursor:pointer;`
const Chain = styled.div`${NAV_SQUARE_BUTTON}border-color:transparent;display:grid;place-items:center;`
const MenuButton = styled.button`${NAV_SQUARE_BUTTON}background:${p => p.theme.colors.primary.saffron};border:none;color:white;font-size:20px;cursor:pointer;`
const Body = styled.main`width:100%;max-width:var(--page-max-width);padding:0 var(--page-padding-x);margin:0 auto;flex:1;`
const Footer = styled.footer`padding:40px 20px 12px;text-align:center;font-size:12px;a{color:${p => p.theme.colors.text.tertiary}}@media(max-width:1300px){padding-bottom:calc(var(--bottom-nav-height) + 12px)}`
const Bottom = styled.nav`display:none;@media(max-width:1300px){position:fixed;z-index:3;bottom:0;left:0;right:0;display:flex;justify-content:space-around;align-items:center;height:var(--bottom-nav-height);background:${p => p.theme.colors.background.base};border-top:1px solid transparent;a,button{font-size:12px;text-transform:uppercase;color:${p => p.theme.colors.text.secondary};background:none;border:0;padding:16px;cursor:pointer}}`
const WalletList = styled.div`display:flex;flex-direction:column;gap:12px;p{font-size:14px;line-height:1.5}`
const WalletButton = styled.button`${NAV_BUTTON_CHROME}${ICON_BUTTON_HOVER}border-color:transparent;height:44px;color:${p => p.theme.colors.text.primary};cursor:pointer;&:disabled{opacity:.5;cursor:default}`
