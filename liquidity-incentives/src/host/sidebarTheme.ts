/** Shared defaults keep the standalone sidebar and its optional preview controls
 * in agreement. Normal builds need neither preset code nor appearance storage. */
// Approved screenshot palette (sRGB, converted from its embedded display profile).
export const sidebarDefaults = {
  style: 'afterglow', surfaceTop: '#0a0a0a', surfaceBottom: '#0a0a0a',
  gradientStart: '#d286ff', gradientMiddle: '#9a29b8', gradientEnd: '#c875ff',
  text: '#d4d4d4', selectedText: '#fff0ff', angle: 150, surfaceAngle: 180,
  glow: 27, glowSpread: 29, strength: 70, border: 75, radius: 12, padding: 12,
  gap: 6, iconSize: 20, orbitSpeed: 3.5, tintAll: false, showIcons: false, indicator: true,
}
export type SidebarAppearance = typeof sidebarDefaults
export const sidebarMobileWidth = 1000
// Reserve the compact rail's space so it never covers the page or its controls.
export const sidebarCollapsedWidth = 64

/** Convert a validated hex color to CSS channels; raw stored CSS is never used. */
export function sidebarChannels(hex: string): string {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')
}

/** Scope presentation variables to the rail. Presets may replace button paint,
 * while density, accessibility and palette controls continue to work normally. */
export function sidebarVariables(value: SidebarAppearance): string {
  const start = sidebarChannels(value.gradientStart), end = sidebarChannels(value.gradientEnd)
  // The approved Afterglow treatment belongs to the normal host as well as
  // staging. Other optional preset treatments remain in the dev-only module.
  const middle = sidebarChannels(value.gradientMiddle), opacity = value.strength / 100
  const approvedPaint = value.style === 'afterglow' ? `
    --sidebar-button-background:radial-gradient(110% 180% at 0% 100%,rgba(${start},${opacity}),rgba(${middle},${opacity}) 38%,transparent 75%),linear-gradient(var(--sidebar-angle),#130d1c,rgba(${end},${opacity}));
    --sidebar-hover-background:var(--sidebar-button-background); --sidebar-hover-text:var(--sidebar-selected-text);
  ` : ''
  return `
    --sidebar-surface-top:${value.surfaceTop}; --sidebar-surface-bottom:${value.surfaceBottom};
    --sidebar-surface-angle:${value.surfaceAngle}deg;
    --sidebar-start:${value.gradientStart}; --sidebar-middle:${value.gradientMiddle}; --sidebar-end:${value.gradientEnd};
    --sidebar-text:${value.text}; --sidebar-selected-text:${value.selectedText}; --sidebar-angle:${value.angle}deg;
    --sidebar-glow:rgba(${start}, ${value.glow / 100}); --sidebar-glow-spread:${value.glowSpread}px;
    --sidebar-button-background:linear-gradient(var(--sidebar-angle),rgba(${start}, ${value.strength / 100}),rgba(${end}, ${value.strength / 500}));
    --sidebar-button-border:rgba(${start}, ${value.border / 100}); --sidebar-button-extra-shadow:0 0 0 transparent;
    --sidebar-button-size:auto; --sidebar-button-motion:none;
    --sidebar-hover-background:rgba(255,255,255,.043); --sidebar-hover-text:#f2f0ea;
    --sidebar-idle-background:${value.tintAll ? 'var(--sidebar-button-background)' : 'transparent'};
    --sidebar-idle-border:${value.tintAll ? 'var(--sidebar-button-border)' : 'transparent'};
    --sidebar-idle-text:${value.tintAll ? 'var(--sidebar-selected-text)' : 'var(--sidebar-text)'};
    --sidebar-idle-motion:${value.tintAll ? 'var(--sidebar-button-motion)' : 'none'};
    --sidebar-radius:${value.radius}px; --sidebar-padding:${value.padding}px; --sidebar-gap:${value.gap}px;
    --sidebar-icon-size:${value.iconSize}px; --sidebar-icons:${value.showIcons ? 'block' : 'none'};
    --sidebar-indicator:${value.indicator ? 'block' : 'none'};
    ${approvedPaint}
  `
}
