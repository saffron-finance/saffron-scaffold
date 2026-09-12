import { useEffect, useId, useRef, useState } from 'react'
import styled from 'styled-components'
import { Emblem3DLogo } from '@fixed/shared/components/emblem3d/Emblem3DLogo'
import { sidebarDestinations, type SidebarIcon } from './sidebarNavigation'
import { sidebarCollapsedWidth, sidebarDefaults, sidebarMobileWidth, sidebarVariables } from './sidebarTheme'

// Small inline line icons keep this shell independent of an icon dependency.
const icons: Record<SidebarIcon, string> = {
  vaults: 'M4 5h16v15H4z M8 5V3h8v2 M8 10h8 M12 8v4 M8 16h8',
  positions: 'M4 18V6h16v12H4z M8 12h8 M12 8v8',
  audits: 'M12 3l8 3v6c0 5-8 9-8 9s-8-4-8-9V6l8-3 M8 12l3 3 5-6',
  community: 'M15 7a3 3 0 1 1-6 0 3 3 0 0 1 6 0 M5 21v-3a7 7 0 0 1 14 0v3 M19 5a3 3 0 0 1 0 6 M21 21v-4a5 5 0 0 0-2-4 M5 5a3 3 0 0 0 0 6 M3 21v-4a5 5 0 0 1 2-4',
}

/** Keep the same logo and icons mounted in either rail size. A single overlay
 * button makes the entire compact rail an accessible reopen target, not links. */
export function Sidebar({ home, collapsed, onToggle }: { home: string; collapsed: boolean; onToggle: () => void }) {
  const [path,setPath]=useState(location.pathname)
  useEffect(()=>{const update=()=>setPath(location.pathname);window.addEventListener('popstate',update);window.addEventListener('saffron:navigation',update);return()=>{window.removeEventListener('popstate',update);window.removeEventListener('saffron:navigation',update)}},[])
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
  return <Rail data-saffron-sidebar data-collapsed={collapsed} aria-label='Saffron sidebar'>
    <Surface data-sidebar-surface>
    <Heading aria-hidden={collapsed || undefined}>
      <Brand href={home} aria-label='Saffron home' title='Saffron home' tabIndex={collapsed ? -1 : undefined}>
        <Logo><Emblem3DLogo /></Logo><span data-sidebar-wordmark>SAFFRON</span>
      </Brand>
      <Collapse ref={toggle} data-sidebar-collapse type='button' aria-label='Collapse sidebar' title='Collapse sidebar'
        aria-expanded={!collapsed} aria-controls={navigationId} onClick={onToggle}>
        <svg viewBox='0 0 24 24' aria-hidden='true'><rect x='4' y='4' width='16' height='16' rx='2' /><path d='M10 4v16' /></svg>
      </Collapse>
    </Heading>
    <Navigation id={navigationId} aria-label='Main navigation' aria-hidden={collapsed || undefined}>
      {sidebarDestinations(home).map(item => <NavItem key={item.href} href={item.href}
        tabIndex={collapsed ? -1 : undefined}
        aria-current={!item.external&&path.replace(/\/$/,'')===item.href.replace(/\/$/,'')?'page':undefined}
        target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>
        <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'><path d={icons[item.icon]} /></svg>
        <span>{item.label}</span>
      </NavItem>)}
    </Navigation>
    <Signature data-sidebar-signature href='https://saffron.finance/' target='_blank' rel='noopener noreferrer'>saffron.finance</Signature>
    </Surface>
    {collapsed && <Reopen ref={reopen} type='button' aria-label='Open sidebar' title='Open sidebar'
      aria-expanded={false} aria-controls={navigationId} onClick={onToggle} />}
  </Rail>
}

const Rail = styled.aside`
  ${sidebarVariables(sidebarDefaults)}
  position:sticky;top:0;height:100vh;height:100dvh;min-width:0;
  @media(max-width:${sidebarMobileWidth}px){position:static;height:auto;}
  /* Attribute specificity keeps collapse above the mobile layout rules. */
  &[data-collapsed=true]{
    position:sticky;top:0;z-index:4;width:${sidebarCollapsedWidth}px;height:100vh;height:100dvh;
    [data-sidebar-surface]{padding:22px 8px 16px;border-right:1px solid #1d1d1d;border-bottom:0;pointer-events:none;}
    [data-sidebar-wordmark],[data-sidebar-collapse],[data-sidebar-signature],nav span{display:none;}
    header{justify-content:center;margin-bottom:28px;}
    nav{flex-direction:column;overflow:visible;padding:0;}
    nav a{justify-content:center;width:100%;padding:12px 10px;}
    nav svg{display:block;width:20px;height:20px;}
    nav a::before{display:none;}
    /* Animate paint only: the hit area stays still so edge hovering cannot flicker. */
    &:hover [data-sidebar-surface]{transform:translateX(4px);}
  }
  @media(prefers-reduced-motion:reduce){&[data-collapsed=true]:hover [data-sidebar-surface]{transform:none;}}
`
const Surface = styled.div`
  height:100%;padding:22px 16px 16px;display:flex;flex-direction:column;overflow:auto;
  border-right:1px solid #1d1d1d;
  background:linear-gradient(var(--sidebar-surface-angle),var(--sidebar-surface-top),var(--sidebar-surface-bottom));
  transition:transform .16s ease-out;
  @media(max-width:${sidebarMobileWidth}px){padding:12px 16px;border-right:0;border-bottom:1px solid #1d1d1d;}
  @media(prefers-reduced-motion:reduce){transition:none;}
`
const Reopen = styled.button`
  position:absolute;inset:0 -4px 0 0;padding:0;border:0;background:transparent;cursor:pointer;
  &:focus-visible{outline:2px solid var(--sidebar-start);outline-offset:-3px;}
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
  border:1px solid transparent;border-radius:0;background:transparent;color:#8a8a8a;cursor:pointer;
  svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;}
  &:hover{color:var(--sidebar-start);background:rgba(255,255,255,.04);}
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
