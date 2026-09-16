import { useEffect, useId, useState } from 'react'
import styled, { createGlobalStyle } from 'styled-components'
import SidebarTweaks from './SidebarTweaks'
import { mobileHomeMaxWidth } from '../host/MobileHomeNavigation'
import { aprAnimations, aprAnimationCss, newOfferBadgeCss, validAprAnimation, type AprAnimation } from './aprAnimations'
// Apply the approved defaults once, then preserve subsequent browser choices.
const typographyKey = 'saffron.feature-lab.table-typography.v2'
// Reuse the preloaded variable WOFF2 faces. Keep saved preset IDs compatible;
// duplicate TTF families caused a second font download/swap after each mount.
const fonts = [
  { id: 'funnel-light', label: 'Funnel Display Light', weight: 300, family: 'Funnel Display' },
  { id: 'funnel-semibold', label: 'Funnel Display Semibold', weight: 600, family: 'Funnel Display' },
  { id: 'host-regular', label: 'Host Grotesk Regular', weight: 400, family: 'Host Grotesk' },
  { id: 'host-medium', label: 'Host Grotesk Medium', weight: 500, family: 'Host Grotesk' },
  { id: 'roboto-regular', label: 'Roboto Mono Regular', weight: 400, family: 'Roboto Mono' },
]
type Typography = { compactHeader: boolean; newOnLeft: boolean; font: string; aprAnimation: AprAnimation; orbitSpeed: number; comingSoonAngle: number }
const defaultTypography: Typography = { compactHeader: true, newOnLeft: false, font: 'funnel-light', aprAnimation: 'orbit', orbitSpeed: 3.5, comingSoonAngle: -7 }

/** Restore known font/animation IDs and a boolean; never inject stored CSS. */
function savedTypography(): Typography {
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

/** Disposable typography/motion preview. Controls, persistence and CSS stay in the
 * standalone host; permanent row styling belongs to the incentive feature.
 */
export default function RowTweaks() {
  const fontId = useId()
  const animationId = useId()
  const speedId = useId()
  const angleId = useId()
  const [typography, setTypography] = useState<Typography>(savedTypography)

  useEffect(() => {
    try { localStorage.setItem(typographyKey, JSON.stringify({ ...typography, aprDefaultVersion: 1, comingSoonDefaultVersion: 1 })) } catch { /* Preview remains usable. */ }
  }, [typography])

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

  return <>
    {/* Desktop appearance preferences remain saved, but do not restyle the
        approved phone cards. The mobile layout has its own fixed hierarchy. */}
    <TableTypography $rules={`@media(min-width:${mobileHomeMaxWidth + 1}px){${headingCss + fontCss + badgeCss}}${speedCss + comingSoonCss + newOfferBadgeCss + aprAnimationCss(typography.aprAnimation)}`} />
    <Control>
      <summary>
        <svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' aria-hidden='true'>
          <path d='m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 1-3-3-2 1-3-3-2-3 1-2-2Z' />
          <circle cx='11.5' cy='11' r='3' />
        </svg>
        Tweak
      </summary>
      <Panel aria-label='Table styling tweaks'>
        <strong>Appearance</strong>
        <Highlight><input type='checkbox' checked={typography.compactHeader}
          onChange={event => setTypography(previous => ({ ...previous, compactHeader: event.target.checked }))} />
          Compact heading</Highlight>
        <small>Compact column labels.</small>
        <Highlight><input type='checkbox' checked={typography.newOnLeft}
          onChange={event => setTypography(previous => ({ ...previous, newOnLeft: event.target.checked }))} />
          NEW on left</Highlight>
        <label htmlFor={fontId}>Table font</label>
        <select id={fontId} value={typography.font}
          onChange={event => setTypography(previous => ({ ...previous, font: event.target.value }))}>
          <option value=''>Site default (mixed fonts)</option>
          {fonts.map(font => <option key={font.id} value={font.id}>{font.label}</option>)}
        </select>
        <label htmlFor={animationId}>APR animation</label>
        <select id={animationId} value={typography.aprAnimation}
          onChange={event => {
            const value = event.target.value
            if (validAprAnimation(value)) setTypography(previous => ({ ...previous, aprAnimation: value }))
          }}>
          {aprAnimations.map(animation => <option key={animation.id} value={animation.id}>{animation.label}</option>)}
        </select>
        <small>{aprAnimations.find(animation => animation.id === typography.aprAnimation)?.description}</small>
        <label htmlFor={speedId}>Orbit speed</label>
        <input id={speedId} type='range' min='.25' max='4' step='.25' value={typography.orbitSpeed}
          aria-valuetext={`${typography.orbitSpeed} times speed`}
          onChange={event => setTypography(previous => ({ ...previous, orbitSpeed: Number(event.target.value) }))} />
        <small>{typography.orbitSpeed}× · {Number(orbitSeconds.toFixed(1))} seconds per orbit. Slide right for faster.</small>
        <label htmlFor={angleId}>Coming soon angle</label>
        <input id={angleId} type='range' min='-30' max='30' step='1' value={typography.comingSoonAngle}
          aria-valuetext={`${typography.comingSoonAngle} degrees`}
          onChange={event => setTypography(previous => ({ ...previous, comingSoonAngle: Number(event.target.value) }))} />
        <small>{typography.comingSoonAngle}° · Slide to tilt the Coming soon label.</small>
        <button type='button' onClick={() => { setTypography(defaultTypography) }}>Reset defaults</button>
        <SidebarTweaks />
        <small>Preview only. Saved in this browser.</small>
      </Panel>
    </Control>
  </>
}

// All styling remains in this dev module; removing its host mount removes both
// the controls and the global overrides, without touching feature components.
const TableTypography = createGlobalStyle<{ $rules: string }>`${({ $rules }) => $rules}`
const Control = styled.details`
  position:fixed;right:24px;bottom:24px;z-index:5;
  font:400 13px ${({ theme }) => theme.fonts.body};color:${({ theme }) => theme.colors.text.primary};
  summary{display:flex;align-items:center;gap:8px;cursor:pointer;list-style:none;padding:11px 15px;
    border:1px solid transparent;border-radius:8px;
    background:${({ theme }) => theme.colors.background.card};}
  summary::-webkit-details-marker{display:none}
  summary:focus-visible{outline:2px solid ${({ theme }) => theme.colors.primary.saffron};outline-offset:3px;}
  @media(max-width:1300px){right:16px;bottom:16px;}
`
const Panel = styled.div`
  position:absolute;right:0;bottom:calc(100% + 10px);width:min(280px, calc(100vw - 32px));
  display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:10px;
  max-height:calc(100dvh - 100px);overflow:auto;
  background:${({ theme }) => theme.colors.background.card};border:1px solid transparent;
  box-shadow:0 8px 28px rgba(0,0,0,.2);
  strong{font:500 17px ${({ theme }) => theme.fonts.display};}
  select,button{font:inherit;color:inherit;border:1px solid transparent;
    background:${({ theme }) => theme.colors.background.elevated};border-radius:6px;padding:10px;}
  button{cursor:pointer;}button[aria-pressed=true]{outline:2px solid ${({ theme }) => theme.colors.primary.saffron};}
  small{color:${({ theme }) => theme.colors.text.secondary};font-size:11px;}
  input[type=range]{width:100%;margin:0;min-height:24px;accent-color:${({ theme }) => theme.colors.accent.gold};cursor:ew-resize;}
`
const Highlight = styled.label`
  display:flex;align-items:center;gap:8px;cursor:pointer;
  input{accent-color:${({ theme }) => theme.colors.accent.gold};}
`
