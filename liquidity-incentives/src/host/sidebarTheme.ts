/** Shared defaults keep the standalone sidebar and its optional preview controls
 * in agreement. Normal builds need neither preset code nor appearance storage. */
export const sidebarDefaults = {
  style: 'reference', surfaceTop: '#0f121a', surfaceBottom: '#0a0c11',
  gradientStart: '#f5d27b', gradientMiddle: '#e47e01', gradientEnd: '#b8842a',
  text: '#98a0af', selectedText: '#f5d27b', angle: 90, surfaceAngle: 180,
  glow: 10, glowSpread: 26, strength: 20, border: 38, radius: 12, padding: 12,
  gap: 6, iconSize: 20, orbitSpeed: 3.5, tintAll: false, showIcons: true, indicator: true,
}
export type SidebarAppearance = typeof sidebarDefaults
export const sidebarMobileWidth = 1000

/** Convert a validated hex color to CSS channels; raw stored CSS is never used. */
export function sidebarChannels(hex: string): string {
  return [1, 3, 5].map(offset => parseInt(hex.slice(offset, offset + 2), 16)).join(', ')
}

/** Scope presentation variables to the rail. Presets may replace button paint,
 * while density, accessibility and palette controls continue to work normally. */
export function sidebarVariables(value: SidebarAppearance): string {
  const start = sidebarChannels(value.gradientStart), end = sidebarChannels(value.gradientEnd)
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
  `
}
