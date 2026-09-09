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

/** Reference-style navigation for the standalone shell. Only one logo renderer
 * is mounted; mobile rearranges the same links rather than duplicating them. */
export function Sidebar({ home }: { home: string }) {
  return <Rail data-saffron-sidebar aria-label='Saffron sidebar'>
    <Brand href={home} aria-label='Saffron home'>
      <Logo><Emblem3DLogo /></Logo><span>SAFFRON</span>
    </Brand>
    <Navigation aria-label='Main navigation'>
      {sidebarDestinations(home).map(item => <NavItem key={item.icon} href={item.href}
        aria-current={item.icon === 'vaults' ? 'page' : undefined}
        target={item.external ? '_blank' : undefined} rel={item.external ? 'noopener noreferrer' : undefined}>
        <svg viewBox='0 0 24 24' aria-hidden='true' focusable='false'><path d={icons[item.icon]} /></svg>
        <span>{item.label}</span>
      </NavItem>)}
    </Navigation>
    <Signature href='https://saffron.finance/' target='_blank' rel='noopener noreferrer'>saffron.finance</Signature>
  </Rail>
}

const Rail = styled.aside`
  ${sidebarVariables(sidebarDefaults)}
  position:sticky;top:0;height:100vh;height:100dvh;min-width:0;padding:22px 16px 16px;
  display:flex;flex-direction:column;overflow:auto;border-right:1px solid rgba(255,255,255,.08);
  background:linear-gradient(180deg,var(--sidebar-surface-top),var(--sidebar-surface-bottom));
  @media(max-width:${sidebarMobileWidth}px){position:static;height:auto;padding:12px 16px;border-right:0;border-bottom:1px solid rgba(255,255,255,.08);}
`
const Brand = styled.a`
  display:flex;align-items:center;gap:12px;padding:4px 8px;margin-bottom:28px;color:#f2f0ea;text-decoration:none;
  span{font:600 18px "Funnel Display",serif;letter-spacing:.16em;}
  &:focus-visible{outline:2px solid var(--sidebar-start);outline-offset:4px;border-radius:8px;}
  @media(max-width:${sidebarMobileWidth}px){margin-bottom:12px;}
`
const Logo = styled.div`width:44px;height:44px;flex:none;`
const Navigation = styled.nav`
  display:flex;flex-direction:column;gap:6px;
  @media(max-width:${sidebarMobileWidth}px){flex-direction:row;gap:4px;overflow-x:auto;padding:2px 0 6px;scrollbar-width:thin;}
`
const NavItem = styled.a`
  position:relative;display:flex;align-items:center;gap:12px;width:100%;padding:12px 14px;
  color:var(--sidebar-text);font:500 14px "Funnel Display",serif;white-space:nowrap;text-decoration:none;
  border:1px solid transparent;border-radius:12px;transition:background .15s,color .15s,border-color .15s;
  svg{width:20px;height:20px;flex:none;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;opacity:.9;}
  &:hover{color:#f2f0ea;background:rgba(255,255,255,.043);}
  &:focus-visible{outline:2px solid var(--sidebar-start);outline-offset:2px;}
  &[aria-current=page]{color:var(--sidebar-start);border-color:var(--sidebar-active-line);
    background:linear-gradient(var(--sidebar-angle),var(--sidebar-start-soft),var(--sidebar-end-soft));
    box-shadow:0 0 26px var(--sidebar-glow);}
  &[aria-current=page]::before{content:'';position:absolute;left:-16px;top:10px;bottom:10px;width:3px;border-radius:3px;
    background:linear-gradient(180deg,var(--sidebar-start),var(--sidebar-end));}
  @media(max-width:${sidebarMobileWidth}px){width:auto;flex:none;padding:10px 12px;&[aria-current=page]::before{display:none;}}
  @media(prefers-reduced-motion:reduce){transition:none;}
`
const Signature = styled.a`
  margin-top:auto;padding:32px 8px 8px;color:var(--sidebar-text);font:400 12px "Funnel Display",serif;text-decoration:none;
  &:hover{color:var(--sidebar-start);}
  @media(max-width:${sidebarMobileWidth}px){display:none;}
`
