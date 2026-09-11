export type SidebarIcon = 'vaults' | 'positions' | 'audits' | 'community'
export interface SidebarDestination { label: string; href: string; icon: SidebarIcon; external?: boolean }

/** Creation and position entry stay within this independent application. */
export function sidebarDestinations(vaultsHref: string): SidebarDestination[] {
  return [
    { label: 'Vaults', href: vaultsHref, icon: 'vaults' },
    { label: 'My requests', href: vaultsHref.replace(/\/$/,'')+'/portfolio/vaults', icon: 'positions' },
    { label: 'Audits', href: 'https://docs.saffron.finance/security/audits', icon: 'audits', external: true },
    { label: 'Community', href: 'https://discord.com/invite/pDXpXKY', icon: 'community', external: true },
  ]
}
