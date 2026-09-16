import './Sidebar.css'
import { Fragment, useEffect, useId, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Emblem3DLogo } from '@fixed/shared/components/emblem3d/Emblem3DLogo'
import { sidebarDestinations, type SidebarIcon } from './sidebarNavigation'
import { AprNavigationLabel } from './aprTextStyle'

// Small inline line icons keep this shell independent of an icon dependency.
const icons: Record<SidebarIcon, string> = {
  admin: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3 M8 12l3 3 5-6',
  status: 'M3 12h4l3-8 4 16 3-8h4',
  guide: 'M12 5v16 M12 5C8 2 4 3 2 4v15c4-2 7-1 10 2 3-3 6-4 10-2V4c-2-1-6-2-10 1',
  live: 'M3 18l5-6 4 3 7-10 M14 5h5v5',
  vaults: 'M4 5h16v15H4z M8 5V3h8v2 M8 10h8 M12 8v4 M8 16h8',
  requests: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
  pro: 'M14 3h7v7 M21 3l-9 9 M10 5H4v15h15v-6',
  stats: 'M4 20V10 M10 20V4 M16 20v-7 M2 20h20',
  audits: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3 M8 12l3 3 5-6',
  community: 'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3 M19 5a3 3 0 0 1 0 6 M21 21v-4a5 5 0 0 0-2-4 M5 5a3 3 0 0 0 0 6 M3 21v-4a5 5 0 0 1 2-4',
}

/** Keep the same logo and icons mounted in either rail size. A single overlay
 * button makes the entire compact rail an accessible reopen target, not links. */
export function Sidebar({ home, collapsed, onToggle }: { home: string; collapsed: boolean; onToggle: () => void }) {
  const path=useLocation().pathname.replace(/\/+$/,'')||'/'
  const navigationId = useId(), reopen = useRef<HTMLButtonElement>(null), toggle = useRef<HTMLButtonElement>(null)
  const previous = useRef(collapsed)
  useEffect(() => {
    if (previous.current === collapsed) return
    previous.current = collapsed
    // Move keyboard focus out of hidden controls. Reopening on a scrolled mobile
    // page also brings the newly revealed menu into view.
    if (collapsed) reopen.current?.focus({ preventScroll: true })
    else toggle.current?.focus()
  }, [collapsed])
  return <aside className='saffron-rail-rail' data-saffron-sidebar data-collapsed={collapsed} aria-label='Saffron sidebar'>
    <div className='saffron-rail-float' data-sidebar-float>
    <div className='saffron-rail-surface' data-sidebar-surface>
    <header className='saffron-rail-heading' aria-hidden={collapsed || undefined}>
      <Link className='saffron-rail-brand' to={home} aria-label='Saffron home' title='Saffron home' tabIndex={collapsed ? -1 : undefined}>
        <div className='saffron-rail-logo'><Emblem3DLogo /></div><span data-sidebar-wordmark>SAFFRON</span>
      </Link>
      <button className='saffron-rail-collapse' ref={toggle} data-sidebar-collapse type='button' aria-label='Collapse sidebar' title='Collapse sidebar'
        aria-expanded={!collapsed} aria-controls={navigationId} onClick={onToggle}>
        <svg viewBox='0 0 24 24' aria-hidden='true'><rect x='4' y='4' width='16' height='16' rx='2' /><path d='M10 4v16' /></svg>
      </button>
    </header>
    <nav className='saffron-rail-navigation' id={navigationId} aria-label='Main navigation' aria-hidden={collapsed || undefined}>
      {sidebarDestinations(home).map(item => <Fragment key={item.href}>{item.icon==='admin'&&<span className='saffron-rail-group-label'>Operator workspace</span>}<Link className='saffron-rail-nav-item' to={item.href}
        tabIndex={collapsed ? -1 : undefined}
        aria-current={!item.external&&(path===item.href||(item.href!=='/'&&path.startsWith(`${item.href}/`)))?'page':undefined}
        target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>
        <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'><path d={icons[item.icon]} /></svg>
        {item.icon==='live'?<AprNavigationLabel>{item.label}</AprNavigationLabel>:<span>{item.label}</span>}
      </Link></Fragment>)}
    </nav>
    <a className='saffron-rail-signature' data-sidebar-signature href='https://saffron.finance/' target='_blank' rel='noopener noreferrer'>saffron.finance</a>
    </div>
    </div>
    {collapsed && <button className='saffron-rail-reopen' ref={reopen} type='button' aria-label='Open sidebar' title='Open sidebar'
      aria-expanded={false} aria-controls={navigationId} onClick={onToggle} />}
  </aside>
}
// First-screen geometry lives in the adjacent cached stylesheet.
