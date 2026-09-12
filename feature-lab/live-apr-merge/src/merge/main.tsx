import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'
import { AppShell, WalletButton, WalletList } from '../host/AppShell'
import { Modal, ModalTitle } from '../host/ui'
import IncentivesPage from '../incentives/IncentivesPage'
import { useMergeSession, resetPreview, usePreviewStorageWarning } from '@merge/session'
import { SectionBoundary } from './SectionBoundary'
import { StatsPage, CommunityPage } from './SectionPages'

// APR does not load or create observations while the user browses Vaults.
const AprSection = lazy(() => import('./AprSection'))
const incentivePaths = new Set(['/', '/campaigns', '/portfolio/vaults', '/admin'])
const pageLabels: Record<string, string> = {
  '/': 'Home', '/campaigns': 'Campaigns', '/portfolio/vaults': 'Portfolio',
  '/admin': 'Administration', '/stats': 'Stats', '/community': 'Community',
}
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

/** One route owner and persistent shell. Only the content feature unmounts when
 * changing sections, releasing APR interest without recreating the sidebar. */
function MergeApp() {
  const session=useMergeSession()
  const location = useLocation()
  const navigate = useNavigate()
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const isApr = path === '/live-apr' || path.startsWith('/live-apr/')
  const sampleMode = incentivePaths.has(path)
  const pageLabel = isApr ? 'Live APR' : pageLabels[path] ?? 'Page not found'
  const [info, setInfo] = useState(false)
  const storageWarning = usePreviewStorageWarning()
  const previous = useRef(path)
  const params = new URLSearchParams(location.search)
  const legacyCampaign = path === '/' && params.get('view') === 'campaigns'
  params.delete('view')

  useEffect(() => {
    document.title = `${pageLabel} · Saffron`
    setInfo(false)
    if (previous.current === path) return
    previous.current = path
    // Main remains a meaningful focus target even while a lazy page is loading.
    document.getElementById('main-content')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [path, pageLabel])

  return <AppShell account={session.headerAccount} liveApr={isApr} pageLabel={pageLabel} sampleMode={sampleMode&&session.preview} onConnect={() => isApr||session.preview?setInfo(true):session.openModal()}
    previewControls={sampleMode && session.preview && <WalletButton onClick={() => { resetPreview(); navigate('/') }}>Reset preview</WalletButton>}
    overlays={<>{session.overlays}<Modal isOpen={info} onRequestClose={() => setInfo(false)}>
      <ModalTitle>{isApr ? 'Live pool observations' : 'Feature Lab preview'}</ModalTitle>
      <WalletList><p>{isApr ? 'APR is measured from live onchain pool activity on Robinhood Chain. Observing a pool needs no wallet connection or transaction. Pool fee APR is not a guaranteed vault return.' : 'Vaults, campaigns and payment review use sample data in this standalone preview. Payments are simulated and changes are saved only in this browser. No wallet connection is needed.'}</p>
        <WalletButton onClick={() => setInfo(false)}>Close</WalletButton>
      </WalletList>
    </Modal></>}>
    {legacyCampaign ? <Navigate replace to={{ pathname: '/campaigns', search: params.toString() ? `?${params}` : '', hash: location.hash }} /> :
      <SectionBoundary key={isApr ? 'apr' : sampleMode ? 'incentives' : path}>
        {isApr ? <Suspense fallback={<Loading role='status'>Loading Live APR…</Loading>}><AprSection /></Suspense> :
          sampleMode ? <>{storageWarning && <StorageNotice role='status'>{storageWarning}</StorageNotice>}<IncentivesPage account={session.account} onConnect={() => session.preview?setInfo(true):session.openModal()} preview={session.preview} /></> :
            path === '/stats' ? <StatsPage /> : path === '/community' ? <CommunityPage /> :
            <Loading><h1>Page not found</h1><Link to='/'>Return to Home</Link></Loading>}
      </SectionBoundary>}
  </AppShell>
}
const Loading = styled.section`padding:24px 0;color:${p => p.theme.colors.text.secondary};`
const StorageNotice = styled.p`font-size:12px;line-height:1.5;color:${p => p.theme.colors.text.tertiary};margin:0 0 16px;`
createRoot(document.getElementById('root')!).render(<BrowserRouter basename={basename}><MergeApp /></BrowserRouter>)
