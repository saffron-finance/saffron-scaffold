/** Shared defaults keep the standalone sidebar and its optional preview controls
 * in agreement. The normal build needs no storage or Tweak component. */
export const sidebarDefaults = {
  surfaceTop: '#0f121a', surfaceBottom: '#0a0c11',
  gradientStart: '#f5d27b', gradientEnd: '#b8842a', text: '#98a0af',
  angle: 90, glow: 10,
}
export type SidebarAppearance = typeof sidebarDefaults
export const sidebarMobileWidth = 1000

/** Convert already-validated hex colors into channels for broadly supported
 * rgba gradients. No CSS text is accepted from browser storage. */
function channels(hex: string): string {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')
}

/** Produce variables scoped to the sidebar only, never the APR or form colors. */
export function sidebarVariables(value: SidebarAppearance): string {
  const start = channels(value.gradientStart), end = channels(value.gradientEnd)
  return `
    --sidebar-surface-top:${value.surfaceTop}; --sidebar-surface-bottom:${value.surfaceBottom};
    --sidebar-start:${value.gradientStart}; --sidebar-end:${value.gradientEnd}; --sidebar-text:${value.text};
    --sidebar-angle:${value.angle}deg;
    --sidebar-start-soft:rgba(${start}, .2); --sidebar-end-soft:rgba(${end}, .04);
    --sidebar-active-line:rgba(${start}, .38); --sidebar-glow:rgba(${start}, ${value.glow / 100});
  `
}
