// Navigation belongs to the standalone host, not the incentive/request feature.
// A consuming app can point this adapter at its own deployment without forks.
const protocolApp = (import.meta.env.VITE_PROTOCOL_APP_URL || 'https://app.saffron.finance').replace(/\/$/, '')
export type SidebarIcon = 'live' | 'vaults' | 'requests' | 'pro' | 'stats' | 'audits' | 'community' | 'admin' | 'status' | 'guide'
export interface SidebarDestination { label: string; href: string; icon: SidebarIcon; external?: boolean }

/** Local destinations share the same shell. Only Saffron pro and Audits leave it;
 * a single Saffron pro link replaces the former protocol-specific destinations. */
export function sidebarDestinations(vaultsHref: string): SidebarDestination[] {
  return [
    { label: 'Home', href: vaultsHref, icon: 'vaults' },
    { label: 'Portfolio', href: '/portfolio/vaults', icon: 'requests' },
    { label: 'Saffron pro', href: `${protocolApp}/`, icon: 'pro', external: true },
    { label: 'Live APR', href: '/live-apr', icon: 'live' },
    { label: 'Stats', href: '/stats', icon: 'stats' },
    { label: 'Audits', href: 'https://docs.saffron.finance/security/audits', icon: 'audits', external: true },
    { label: 'Community', href: '/community', icon: 'community' },
    { label: 'Administration', href: '/admin', icon: 'admin' },
    { label: 'Status', href: '/status', icon: 'status' },
    { label: 'Journey Guide', href: '/journey', icon: 'guide' },
  ]
}
