import { mobileHomeMaxWidth } from '../host/layout'
import { sidebarDefaults, sidebarVariables, type SidebarAppearance } from '../host/sidebarTheme'
import { sidebarOrbitCss, sidebarPreset, sidebarPresetCss } from './sidebarPresets'
import { aprAnimationCss, newOfferBadgeCss, validAprAnimation, type AprAnimation } from './aprAnimations'

export const typographyKey = 'saffron.feature-lab.table-typography.v2'
// Reuse the preloaded variable WOFF2 faces. Keep saved preset IDs compatible;
// duplicate TTF families caused a second font download/swap after each mount.
export const fonts = [
  { id: 'funnel-light', label: 'Funnel Display Light', weight: 300, family: 'Funnel Display' },
  { id: 'funnel-semibold', label: 'Funnel Display Semibold', weight: 600, family: 'Funnel Display' },
  { id: 'host-regular', label: 'Host Grotesk Regular', weight: 400, family: 'Host Grotesk' },
  { id: 'host-medium', label: 'Host Grotesk Medium', weight: 500, family: 'Host Grotesk' },
  { id: 'roboto-regular', label: 'Roboto Mono Regular', weight: 400, family: 'Roboto Mono' },
]
export type Typography = { compactHeader: boolean; newOnLeft: boolean; font: string; aprAnimation: AprAnimation; orbitSpeed: number; comingSoonAngle: number }
export const defaultTypography: Typography = { compactHeader: true, newOnLeft: false, font: 'funnel-light', aprAnimation: 'orbit', orbitSpeed: 3.5, comingSoonAngle: -7 }

/** Restore known font/animation IDs and a boolean; never inject stored CSS. */
export function savedTypography(): Typography {
  try {
    const saved = JSON.parse(localStorage.getItem(typographyKey) || '{}')
    // Replace the old auto-saved None default once. Other presets survive, and
    // choosing None after this update remains an explicit, persistent choice.
    const animation = saved?.aprDefaultVersion === 1 || saved?.aprAnimation !== 'none' ? saved?.aprAnimation : undefined
    return { compactHeader: typeof saved?.compactHeader === 'boolean' ? saved.compactHeader : defaultTypography.compactHeader,
      newOnLeft: typeof saved?.newOnLeft === 'boolean' ? saved.newOnLeft : defaultTypography.newOnLeft,
      font: saved?.font === '' || fonts.some(font => font.id === saved?.font) ? saved.font : defaultTypography.font,
      aprAnimation: validAprAnimation(animation) ? animation : defaultTypography.aprAnimation,
      // Preserve valid saved speeds; missing/invalid settings use the current default.
      orbitSpeed: typeof saved?.orbitSpeed === 'number' && Number.isFinite(saved.orbitSpeed)
        && saved.orbitSpeed >= .25 && saved.orbitSpeed <= 4 ? saved.orbitSpeed : defaultTypography.orbitSpeed,
      // Apply the approved -7 degree angle once, then preserve later slider
      // choices. Only bounded numeric angles can reach the CSS variable.
      comingSoonAngle: saved?.comingSoonDefaultVersion === 1 && typeof saved?.comingSoonAngle === 'number' && Number.isFinite(saved.comingSoonAngle)
        && saved.comingSoonAngle >= -30 && saved.comingSoonAngle <= 30 ? saved.comingSoonAngle : defaultTypography.comingSoonAngle }
  } catch { return defaultTypography }
}

export const storageKey = 'saffron.staging.sidebar.v1'
// Apply the approved page design once; later explicit Tweak choices still persist.
export const defaultsVersion = 2
export const colors = [
  ['surfaceTop', 'Background top'], ['surfaceBottom', 'Background bottom'],
  ['gradientStart', 'Gradient start'], ['gradientMiddle', 'Gradient middle'], ['gradientEnd', 'Gradient end'],
  ['text', 'Navigation text'], ['selectedText', 'Highlighted text'],
] as const
// One definition drives slider bounds, accessible labels, and storage validation.
export const paintSliders = [
  ['angle', 'Gradient direction', 0, 360, 15, '°'], ['surfaceAngle', 'Background direction', 0, 360, 15, '°'],
  ['strength', 'Highlight strength', 5, 100, 1, '%'], ['border', 'Border strength', 0, 100, 1, '%'],
  ['glow', 'Sidebar glow', 0, 60, 1, '%'], ['glowSpread', 'Glow spread', 0, 48, 1, 'px'],
] as const
export const shapeSliders = [
  ['radius', 'Corner radius', 0, 24, 1, 'px'], ['padding', 'Button padding', 8, 18, 1, 'px'],
  ['gap', 'Row spacing', 0, 16, 1, 'px'], ['iconSize', 'Icon size', 16, 24, 1, 'px'],
] as const
export const orbitSlider = ['orbitSpeed', 'Sidebar orbit speed', .25, 4, .25, '×'] as const
export const toggles = [['tintAll', 'Style all buttons'], ['showIcons', 'Show icons'], ['indicator', 'Show active indicator']] as const

/** Restore only known presets, hex colors, booleans and bounded numbers.
 * Apply approved defaults to older storage once; preserve subsequent choices. */
export function savedAppearance(): SidebarAppearance {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '{}'), result = { ...sidebarDefaults }
    if (stored?.defaultsVersion !== defaultsVersion) return result
    for (const [key] of colors) if (typeof stored?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(stored[key])) result[key] = stored[key]
    if (stored?.selectedText === undefined) result.selectedText = result.gradientStart
    for (const [key, , min, max] of [...paintSliders, ...shapeSliders, orbitSlider]) {
      if (typeof stored?.[key] === 'number' && Number.isFinite(stored[key]) && stored[key] >= min && stored[key] <= max) result[key] = stored[key]
    }
    for (const [key] of toggles) if (typeof stored?.[key] === 'boolean') result[key] = stored[key]
    if (sidebarPreset(stored?.style)) result.style = stored.style
    return result
  } catch { return { ...sidebarDefaults } }
}

/** Derive first-frame CSS from validated values without mounting editor inputs.
 * The same state is passed to the on-demand editor; opening it cannot restyle
 * the page or reset a saved selection. No stored string is accepted as CSS. */
export function appearanceCss(typography: Typography, appearance: SidebarAppearance): string {
  const table = '[data-incentive-programs]'
  const heading = `${table} > [aria-hidden="true"]`
  const font = fonts.find(face => face.id === typography.font)
  // Larger slider values mean faster motion. CSS still renders every frame.
  const orbitSeconds = 24 / typography.orbitSpeed
  const speedCss = `[data-incentive-apr], [data-incentive-new], [data-apr-navigation] { --saffron-orbit-duration:${orbitSeconds}s; }`
  const comingSoonCss = `${table} { --incentive-coming-soon-angle:${typography.comingSoonAngle}deg; }`
  // Move a reserved named track, not just the painted badge: headers and all
  // rows stay aligned. These overrides and their storage are lab-only.
  const badgeCss = typography.newOnLeft ? `
    ${table} {
      --incentive-leading-badge:[new] 56px;
      --incentive-trailing-badge:[end];
      --incentive-badge-align:start;
      --incentive-mobile-columns:[new] 38px [yield] 40px [apr] minmax(0,1fr) [duration] minmax(0,1fr) [tvl] minmax(0,1fr);
    }
  ` : ''
  // The feature owns the transparent heading and 4px gap in every build.
  // This optional control changes only label typography.
  const headingCss = typography.compactHeader ? `
    ${heading} > span { padding-top:8px; padding-bottom:8px; }
  ` : ''
  // Select the shared family/weight without registering a late font face.
  // Semantic colors and font sizes outside the table are left untouched.
  // APR values retain their approved Funnel Display 500 instead of preview overrides.
  const fontCss = font ? `
    ${table}, ${table} :not([data-incentive-apr]) { font-family:"${font.family}" !important; font-weight:${font.weight} !important; }
  ` : ''

  return `@media(min-width:${mobileHomeMaxWidth + 1}px){${headingCss + fontCss + badgeCss}}${speedCss + comingSoonCss + newOfferBadgeCss + aprAnimationCss(typography.aprAnimation)}
  [data-saffron-sidebar][data-saffron-sidebar],
  [data-incentive-primary-action][data-incentive-primary-action],
  [data-incentive-back][data-incentive-back]{${sidebarVariables(appearance) + sidebarPresetCss(appearance)}}
  ${sidebarOrbitCss}`
}
