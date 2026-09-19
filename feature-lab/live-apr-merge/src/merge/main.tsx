import { setViewerWallet } from '../host/transport'
import { lazy, Suspense, useEffect, useLayoutEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, useLocation } from 'react-router-dom'
import styled from 'styled-components'
import { AppShell } from '../host/AppShell'
import IncentivesPage from '../incentives/IncentivesPage'
import { useMergeSession } from '@merge/session'
import { SectionBoundary } from './SectionBoundary'
import { StatsPage, CommunityPage } from './SectionPages'
import { RootBoundary } from '../host/RenderBoundary'

// APR does not load or create observations while the user browses Vaults.
const AprSection = lazy(() => import('./AprSection'))
const incentivePaths = new Set(['/', '/incentive-programs', '/incentive-programs/new', '/portfolio/vaults', '/admin', '/status', '/journey'])
const pageLabels: Record<string, string> = {
  '/': 'Home', '/incentive-programs': 'Incentive programs', '/incentive-programs/new': 'Create incentive program', '/portfolio/vaults': 'Portfolio',
  '/admin': 'Administration', '/status': 'Status', '/journey': 'Journey Guide', '/stats': 'Stats', '/community': 'Community',
}
const basename = import.meta.env.BASE_URL.replace(/\/+$/, '') || '/'

/** One route owner and persistent shell. Only the content feature unmounts when
 * changing sections, releasing APR interest without recreating the sidebar. */
function MergeApp() {
  useLayoutEffect(()=>{
    // The root swap is one React commit, so there is no intermediate blank
    // frame. Remove build-only snapshot CSS only after live styles exist.
    const root=document.getElementById('root')!
    root.inert=false;delete root.dataset.warmDisplay
    document.querySelectorAll('[data-warm-css],template[id^="warm-"]').forEach(node=>node.remove())
    performance.mark('saffron:app-ready')
  },[])
  const session=useMergeSession()
  const location = useLocation()
  const path = location.pathname.replace(/\/+$/, '') || '/'
  useEffect(() => { setViewerWallet(session.account) }, [session.account])
  const isApr = path === '/live-apr' || path.startsWith('/live-apr/')
  const isIncentives = incentivePaths.has(path)
  const pageLabel = isApr ? 'Live APR' : pageLabels[path] ?? 'Page not found'
  const previous = useRef(path)
  const params = new URLSearchParams(location.search)
  // Keep old bookmarks and the original query route, preserving other query/hash data.
  const legacyProgramRoute=path==='/campaigns'||path==='/campaigns/new'||(path==='/'&&params.get('view')==='campaigns')
  const legacyProgramTarget=path==='/campaigns/new'?'/incentive-programs/new':'/incentive-programs'
  params.delete('view')

  useEffect(() => {
    document.title = `${pageLabel} · Saffron`
    if (previous.current === path) return
    previous.current = path
    // Main remains a meaningful focus target even while a lazy page is loading.
    document.getElementById('main-content')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [path, pageLabel])

  return <AppShell account={session.account} chainId={session.chainId} liveApr={isApr} pageLabel={pageLabel} onConnect={session.openModal} overlays={session.overlays}>
    {legacyProgramRoute ? <Navigate replace to={{ pathname: legacyProgramTarget, search: params.toString() ? `?${params}` : '', hash: location.hash }} /> :
      <SectionBoundary key={path}>
        {isApr ? <Suspense fallback={<Loading role='status'>Loading Live APR…</Loading>}><AprSection /></Suspense> :
          isIncentives ? <IncentivesPage account={session.account} onConnect={session.openModal} /> :
            path === '/stats' ? <StatsPage /> : path === '/community' ? <CommunityPage /> :
            <Loading><h1>Page not found</h1><Link to='/'>Return to Home</Link></Loading>}
      </SectionBoundary>}
  </AppShell>
}
const Loading = styled.section`padding:24px 0;color:${p => p.theme.colors.text.secondary};`
// RootBoundary remains actionable even if the normal application cannot mount.
document.getElementById('root')!.inert=false
createRoot(document.getElementById('root')!).render(<RootBoundary><BrowserRouter basename={basename}><MergeApp /></BrowserRouter></RootBoundary>)
