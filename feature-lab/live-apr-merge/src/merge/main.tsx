import { lazy, Suspense, useEffect, useRef } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Link, Navigate, useLocation } from 'react-router-dom'
import styled from 'styled-components'
import { AppShell } from '../host/AppShell'
import IncentivesPage from '../incentives/IncentivesPage'
import { useMergeSession } from '@merge/session'
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
  const path = location.pathname.replace(/\/+$/, '') || '/'
  const isApr = path === '/live-apr' || path.startsWith('/live-apr/')
  const isIncentives = incentivePaths.has(path)
  const pageLabel = isApr ? 'Live APR' : pageLabels[path] ?? 'Page not found'
  const previous = useRef(path)
  const params = new URLSearchParams(location.search)
  const legacyCampaign = path === '/' && params.get('view') === 'campaigns'
  params.delete('view')

  useEffect(() => {
    document.title = `${pageLabel} · Saffron`
    if (previous.current === path) return
    previous.current = path
    // Main remains a meaningful focus target even while a lazy page is loading.
    document.getElementById('main-content')?.focus({ preventScroll: true })
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [path, pageLabel])

  return <AppShell account={session.account} liveApr={isApr} pageLabel={pageLabel} onConnect={session.openModal} overlays={session.overlays}>
    {legacyCampaign ? <Navigate replace to={{ pathname: '/campaigns', search: params.toString() ? `?${params}` : '', hash: location.hash }} /> :
      <SectionBoundary key={isApr ? 'apr' : isIncentives ? 'incentives' : path}>
        {isApr ? <Suspense fallback={<Loading role='status'>Loading Live APR…</Loading>}><AprSection /></Suspense> :
          isIncentives ? <IncentivesPage account={session.account} onConnect={session.openModal} /> :
            path === '/stats' ? <StatsPage /> : path === '/community' ? <CommunityPage /> :
            <Loading><h1>Page not found</h1><Link to='/'>Return to Home</Link></Loading>}
      </SectionBoundary>}
  </AppShell>
}
const Loading = styled.section`padding:24px 0;color:${p => p.theme.colors.text.secondary};`
createRoot(document.getElementById('root')!).render(<BrowserRouter basename={basename}><MergeApp /></BrowserRouter>)
