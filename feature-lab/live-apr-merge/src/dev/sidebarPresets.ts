import { sidebarChannels, sidebarDefaults, type SidebarAppearance } from '../host/sidebarTheme'

// Presets are preview-only data, not additional components or dependencies.
// Selecting one changes its palette/paint, leaving layout and scope choices intact.
export const sidebarPresets = [
  { id: 'reference', label: 'Reference (gold)', colors: ['#f5d27b', '#e47e01', '#b8842a'], ink: '#f5d27b', glow: 10, strength: 20 },
  { id: 'classic', label: '01 · Classic sunset', colors: ['#ffbc09', '#e47e01', '#fa3f06'], ink: '#170b03', glow: 18, strength: 100 },
  { id: 'dusk', label: '02 · Purple dusk', colors: ['#ff5700', '#9127b5', '#2b084a'], ink: '#fff2e5', glow: 24, strength: 72 },
  { id: 'ember', label: '03 · Ember glass', colors: ['#ff7d24', '#ed460d', '#351028'], ink: '#ffdfbd', glow: 24, strength: 50 },
  { id: 'horizon', label: '04 · Golden horizon', colors: ['#ffd15a', '#f28a0a', '#71103d'], ink: '#fff3ce', glow: 16, strength: 65 },
  { id: 'afterglow', label: '05 · Violet afterglow (default)', colors: [sidebarDefaults.gradientStart, sidebarDefaults.gradientMiddle, sidebarDefaults.gradientEnd], ink: sidebarDefaults.selectedText, glow: sidebarDefaults.glow, strength: sidebarDefaults.strength },
  { id: 'outline', label: '06 · Sunset outline', colors: ['#ffbc09', '#f36f10', '#b13ce4'], ink: '#ffe5b8', glow: 16, strength: 90 },
  { id: 'silk', label: '07 · Sunset silk', colors: ['#ffcd65', '#df591d', '#612365'], ink: '#fff4df', glow: 18, strength: 75 },
  { id: 'aurora', label: '08 · Saffron aurora', colors: ['#ffad24', '#ff431c', '#9225da'], ink: '#fff0e3', glow: 26, strength: 68 },
  { id: 'molten', label: '09 · Molten edge', colors: ['#ff9c0d', '#ee4410', '#451237'], ink: '#ffe7c7', glow: 22, strength: 55 },
  { id: 'orbit', label: '10 · Sunset orbit', colors: ['#ffbc09', '#fa5706', '#8327c2'], ink: '#fff2de', glow: 22, strength: 72 },
] as const

/** Resolve only known IDs, including restored browser preferences. */
export function sidebarPreset(id: string) {
  return sidebarPresets.find(preset => preset.id === id)
}

/** A preset supplies its recommended colors; custom spacing/icon choices survive. */
export function applySidebarPreset(value: SidebarAppearance, id: string): SidebarAppearance {
  const preset = sidebarPreset(id)
  if (!preset) return value
  return { ...value, style: preset.id, gradientStart: preset.colors[0], gradientMiddle: preset.colors[1],
    gradientEnd: preset.colors[2], selectedText: preset.ink, glow: preset.glow, strength: preset.strength,
    angle: preset.id === 'afterglow' ? sidebarDefaults.angle : preset.id === 'reference' ? 90 : 110 }
}

/** Compose ten distinct CSS-only paint treatments from the editable palette.
 * Alpha tracks highlight strength. Orbit alone animates; reduced motion is static. */
export function sidebarPresetCss(value: SidebarAppearance): string {
  if (value.style === 'reference' || value.style === 'afterglow') return ''
  const opacity = value.strength / 100
  const color = (hex: string, amount = 1) => `rgba(${sidebarChannels(hex)}, ${opacity * amount})`
  const a = color(value.gradientStart), b = color(value.gradientMiddle), c = color(value.gradientEnd)
  const angle = 'var(--sidebar-angle)', base = '#130d1c'
  const paints: Record<string, string> = {
    classic: `linear-gradient(${angle},${a} 10%,${b} 65%,${c} 100%),${base}`,
    dusk: `radial-gradient(75% 95% at 78% 0%,${a},${color(value.gradientMiddle, .48)} 38%,transparent 66%),${value.gradientEnd}`,
    ember: `radial-gradient(100% 140% at 100% 0%,${a},transparent 70%),linear-gradient(${angle},${color(value.gradientMiddle, .18)},${color(value.gradientEnd, .5)}),${base}`,
    horizon: `linear-gradient(${angle},${color(value.gradientEnd, .65)},transparent),linear-gradient(0deg,${a},${b} 12%,${color(value.gradientEnd, .4)} 48%,transparent),${base}`,
    outline: `linear-gradient(${base},${base}) padding-box,linear-gradient(${angle},${color(value.gradientStart, value.border / 100)},${color(value.gradientMiddle, value.border / 100)} 55%,${color(value.gradientEnd, value.border / 100)}) border-box`,
    silk: `linear-gradient(${angle},${c},${b} 35%,${color(value.gradientStart, .7)} 48%,${b} 62%,${c}),${base}`,
    aurora: `radial-gradient(85% 170% at 10% 0%,${a},transparent 65%),radial-gradient(90% 160% at 100% 100%,${c},transparent 70%),linear-gradient(${angle},${color(value.gradientMiddle, .3)},transparent),${base}`,
    molten: `linear-gradient(0deg,${color(value.gradientStart, .3)},transparent 55%),linear-gradient(${angle},${color(value.gradientEnd, .3)},${color(value.gradientMiddle, .12)}),${base}`,
    orbit: `radial-gradient(ellipse at 20% 20%,${a},${b} 35%,transparent 72%),linear-gradient(${angle},${color(value.gradientEnd, .75)},${base})`,
  }
  const paint = paints[value.style]
  if (!paint) return ''
  return `
    /* Presets own selected paint; inherit the shared gray hover and readable ink. */
    --sidebar-button-background:${paint};
    ${value.style === 'outline' ? '--sidebar-button-border:transparent;' : ''}
    ${value.style === 'molten' ? '--sidebar-button-extra-shadow:inset 0 -3px 0 var(--sidebar-start);' : ''}
    ${value.style === 'orbit' ? `--sidebar-button-size:180% 180%; --sidebar-button-motion:saffronSidebarOrbit ${24 / value.orbitSpeed}s ease-in-out infinite;` : ''}
  `
}

// Do not animate layout, text position, or opacity. This never makes API calls.
export const sidebarOrbitCss = `
  @keyframes saffronSidebarOrbit {
    0%,100% { background-position:0% 0%; } 25% { background-position:100% 0%; }
    50% { background-position:100% 100%; } 75% { background-position:0% 100%; }
  }
`
