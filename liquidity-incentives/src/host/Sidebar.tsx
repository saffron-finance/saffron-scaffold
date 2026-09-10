import { useEffect, useId, useRef, useState, type MouseEvent, type KeyboardEvent } from 'react'
import styled from 'styled-components'
import { Emblem3DLogo } from '@fixed/shared/components/emblem3d/Emblem3DLogo'
import { sidebarDestinations, type SidebarIcon } from './sidebarNavigation'
import { sidebarDefaults, sidebarMobileWidth, sidebarVariables } from './sidebarTheme'

// Small inline line icons keep this shell independent of an icon dependency.
const icons: Record<SidebarIcon, string> = {
  vaults: 'M4 5h16v15H4z M8 5V3h8v2 M8 10h8 M12 8v4 M8 16h8',
  tokens: 'M15 9a6 6 0 1 1-12 0 6 6 0 0 1 12 0 M15 9a6 6 0 1 1-6 6 M9 6v6 M6 9h6',
  fixed: 'M4 18V6h16v12H4z M8 12h8 M12 8v8',
  variable: 'M3 18l5-6 4 3 7-10 M14 5h5v5',
  stats: 'M4 20V10 M10 20V4 M16 20v-7 M2 20h20',
  audits: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3 M8 12l3 3 5-6',
  community: 'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3 M19 5a3 3 0 0 1 0 6 M21 21v-4a5 5 0 0 0-2-4 M5 5a3 3 0 0 0 0 6 M3 21v-4a5 5 0 0 1 2-4',
}

/** One persistent logo canvas serves both the rail and the floating reopen
 * control. Hiding navigation never unmounts the WebGL renderer or the page. */
export function Sidebar({ home, collapsed, onToggle }: { home: string; collapsed: boolean; onToggle: () => void }) {
  const [path,setPath]=useState(location.pathname)
  useEffect(()=>{const update=()=>setPath(location.pathname);window.addEventListener('popstate',update);window.addEventListener('saffron:navigation',update);return()=>{window.removeEventListener('popstate',update);window.removeEventListener('saffron:navigation',update)}},[])
  const navigationId = useId(), logo = useRef<HTMLAnchorElement>(null), toggle = useRef<HTMLButtonElement>(null)
  const previous = useRef(collapsed)
  useEffect(() => {
    if (previous.current === collapsed) return
    previous.current = collapsed
    // Move keyboard focus out of hidden controls. Reopening on a scrolled mobile
    // page also brings the newly revealed menu into view.
    if (collapsed) logo.current?.focus({ preventScroll: true })
    else toggle.current?.focus()
  }, [collapsed])
  return <Rail data-saffron-sidebar data-collapsed={collapsed} aria-label='Saffron sidebar'>
    <Heading>
      <Brand ref={logo} href={home} aria-label={collapsed ? 'Open sidebar' : 'Saffron home'}
        role={collapsed ? 'button' : undefined} aria-expanded={collapsed ? false : undefined}
        aria-controls={collapsed ? navigationId : undefined} title={collapsed ? 'Open sidebar' : 'Saffron home'}
        onClick={(event: MouseEvent<HTMLAnchorElement>) => { if (collapsed) { event.preventDefault(); onToggle() } }}
        onKeyDown={(event: KeyboardEvent<HTMLAnchorElement>) => { if (collapsed && event.key === ' ') { event.preventDefault(); onToggle() } }}>
        <Logo><Emblem3DLogo /></Logo><span data-sidebar-wordmark>SAFFRON</span>
      </Brand>
      <Collapse ref={toggle} data-sidebar-collapse type='button' aria-label='Hide sidebar' title='Hide sidebar'
        aria-expanded={!collapsed} aria-controls={navigationId} onClick={onToggle}>
        <svg viewBox='0 0 24 24' aria-hidden='true'><path d='M19 12H5m6-6-6 6 6 6' /></svg>
      </Collapse>
    </Heading>
    <Navigation id={navigationId} aria-label='Main navigation'>
      {sidebarDestinations(home).map(item => <NavItem key={item.icon} href={item.href}
        aria-current={!item.external&&path.replace(/\/$/,'')===item.href.replace(/\/$/,'')?'page':undefined}
        target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>
        <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'><path d={icons[item.icon]} /></svg>
        <span>{item.label}</span>
      </NavItem>)}
    </Navigation>
    <Signature data-sidebar-signature href='https://saffron.finance/' target='_blank' rel='noopener noreferrer'>saffron.finance</Signature>
  </Rail>
}

const Rail = styled.aside`
  ${sidebarVariables(sidebarDefaults)}
  position:sticky;top:0;height:100vh;height:100dvh;min-width:0;padding:22px 16px 16px;
  display:flex;flex-direction:column;overflow:auto;border-right:1px solid #1d1d1d;
  background:linear-gradient(var(--sidebar-surface-angle),var(--sidebar-surface-top),var(--sidebar-surface-bottom));
  @media(max-width:${sidebarMobileWidth}px){position:static;height:auto;padding:12px 16px;border-right:0;border-bottom:1px solid #1d1d1d;}
  /* Attribute specificity keeps collapse above the mobile layout rules. */
  &[data-collapsed=true]{
    position:fixed;top:12px;left:12px;z-index:4;width:56px;height:56px;padding:6px;
    border:0;background:transparent;overflow:visible;
    nav,[data-sidebar-wordmark],[data-sidebar-collapse],[data-sidebar-signature]{display:none;}
    header{margin:0;}
    a{animation:saffronSidebarPop .18s ease-out;}
  }
  @keyframes saffronSidebarPop{from{transform:scale(.85)}to{transform:scale(1)}}
  @media(prefers-reduced-motion:reduce){&[data-collapsed=true] a{animation:none;}}
`
const Heading = styled.header`
  display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:28px;
  @media(max-width:${sidebarMobileWidth}px){margin-bottom:12px;}
`
const Brand = styled.a`
  display:flex;align-items:center;gap:8px;min-width:0;color:#f2f0ea;text-decoration:none;cursor:pointer;
  span{font:600 16px "Funnel Display",serif;letter-spacing:.14em;}
  &:focus-visible{outline:2px solid var(--sidebar-start);outline-offset:3px;border-radius:8px;}
`
const Logo = styled.div`width:44px;height:44px;flex:none;`
const Collapse = styled.button`
  width:32px;height:32px;flex:none;padding:6px;display:grid;place-items:center;
  border:1px solid rgba(255,255,255,.24);border-radius:0;background:#0b0b10;color:#ddd;cursor:pointer;
  svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}
  &:hover{color:var(--sidebar-start);border-color:var(--sidebar-start);}
  &:focus-visible{outline:2px solid var(--sidebar-start);outline-offset:3px;}
`
const Navigation = styled.nav`
  display:flex;flex-direction:column;gap:var(--sidebar-gap);
  @media(max-width:${sidebarMobileWidth}px){flex-direction:row;overflow-x:auto;padding:2px 0 6px;scrollbar-width:thin;}
`
const NavItem = styled.a`
  position:relative;display:flex;align-items:center;gap:12px;width:100%;padding:var(--sidebar-padding) 14px;
  color:var(--sidebar-idle-text);font:500 14px "Funnel Display",serif;white-space:nowrap;text-decoration:none;
  border:1px solid var(--sidebar-idle-border);border-radius:var(--sidebar-radius);
  background:var(--sidebar-idle-background);background-size:var(--sidebar-button-size);animation:var(--sidebar-idle-motion);
  transition:color .15s,border-color .15s,box-shadow .15s;
  svg{display:var(--sidebar-icons);width:var(--sidebar-icon-size);height:var(--sidebar-icon-size);flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.9;}
  &:hover{color:var(--sidebar-hover-text);background:var(--sidebar-hover-background);
    background-size:var(--sidebar-button-size);animation:var(--sidebar-button-motion);}
  &:focus-visible{outline:2px solid var(--sidebar-start);outline-offset:2px;}
  &[aria-current=page]{color:var(--sidebar-selected-text);border-color:var(--sidebar-button-border);
    background:var(--sidebar-button-background);background-size:var(--sidebar-button-size);animation:var(--sidebar-button-motion);
    box-shadow:var(--sidebar-button-extra-shadow),0 0 var(--sidebar-glow-spread) var(--sidebar-glow);}
  &[aria-current=page]::before{content:'';display:var(--sidebar-indicator);position:absolute;left:-16px;top:10px;bottom:10px;width:3px;border-radius:3px;
    background:linear-gradient(180deg,var(--sidebar-start),var(--sidebar-end));}
  @media(max-width:${sidebarMobileWidth}px){width:auto;flex:none;padding:var(--sidebar-padding) 12px;&[aria-current=page]::before{display:none;}}
  @media(prefers-reduced-motion:reduce){&, &:hover, &[aria-current=page]{transition:none;animation:none;background-position:50% 50%;}}
`
const Signature = styled.a`
  margin-top:auto;padding:32px 8px 8px;color:var(--sidebar-text);font:400 12px "Funnel Display",serif;text-decoration:none;
  &:hover{color:var(--sidebar-start);}
  @media(max-width:${sidebarMobileWidth}px){display:none;}
`
