// Navigation belongs to the standalone host, not the incentive/request feature.
// A consuming app can point this adapter at its own deployment without forks.
const protocolApp = (import.meta.env.VITE_PROTOCOL_APP_URL || 'https://beta.saffron.finance').replace(/\/$/, '')
export type SidebarIcon = 'vaults' | 'tokens' | 'fixed' | 'variable' | 'stats' | 'audits' | 'community'
export interface SidebarDestination { label: string; href: string; icon: SidebarIcon; external?: boolean }

/** Vaults stays in this preview. Other sections use existing protocol routes,
 * with explicit view parameters so fixed/variable links cannot swap meanings. */
export function sidebarDestinations(vaultsHref: string): SidebarDestination[] {
  return [
    { label: 'Vaults', href: vaultsHref, icon: 'vaults' },
    { label: 'Tokens', href: `${protocolApp}/network/robinhood`, icon: 'tokens', external: true },
    { label: 'Fixed yield', href: `${protocolApp}/network/robinhood/vaults?view=fixed`, icon: 'fixed', external: true },
    { label: 'Variable yield', href: `${protocolApp}/network/robinhood/vaults?view=variable`, icon: 'variable', external: true },
    { label: 'Stats', href: `${protocolApp}/stats`, icon: 'stats', external: true },
    { label: 'Audits', href: 'https://docs.saffron.finance/security/audits', icon: 'audits', external: true },
    { label: 'Community', href: 'https://discord.com/invite/pDXpXKY', icon: 'community', external: true },
  ]
}
