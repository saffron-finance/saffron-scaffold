import { useEffect, useId, useState } from 'react'
import styled, { createGlobalStyle } from 'styled-components'
import { aprAnimations, aprAnimationCss, validAprAnimation, type AprAnimation } from './aprAnimations'
import funnelLight from './fonts/FunnelDisplay-Light.ttf'
import funnelSemibold from './fonts/FunnelDisplay-SemiBold.ttf'
import hostRegular from './fonts/HostGrotesk-Regular.ttf'
import hostMedium from './fonts/HostGrotesk-Medium.ttf'
import robotoRegular from './fonts/RobotoMono-Regular.ttf'

// Apply the approved defaults once, then preserve subsequent browser choices.
const typographyKey = 'saffron.feature-lab.table-typography.v2'
// Exact five faces from fixed-income's brand.css; assets stay in the dev chunk.
const fonts = [
  { id: 'funnel-light', label: 'Funnel Display Light', weight: 300, src: funnelLight },
  { id: 'funnel-semibold', label: 'Funnel Display Semibold', weight: 600, src: funnelSemibold },
  { id: 'host-regular', label: 'Host Grotesk Regular', weight: 400, src: hostRegular },
  { id: 'host-medium', label: 'Host Grotesk Medium', weight: 500, src: hostMedium },
  { id: 'roboto-regular', label: 'Roboto Mono Regular', weight: 400, src: robotoRegular },
]
type Typography = { compactHeader: boolean; font: string; aprAnimation: AprAnimation }
const defaultTypography: Typography = { compactHeader: true, font: 'funnel-light', aprAnimation: 'none' }

/** Restore known font/animation IDs and a boolean; never inject stored CSS. */
function savedTypography(): Typography {
  try {
    const saved = JSON.parse(localStorage.getItem(typographyKey) || '{}')
    return { compactHeader: typeof saved?.compactHeader === 'boolean' ? saved.compactHeader : defaultTypography.compactHeader,
      font: saved?.font === '' || fonts.some(font => font.id === saved?.font) ? saved.font : defaultTypography.font,
      aprAnimation: validAprAnimation(saved?.aprAnimation) ? saved.aprAnimation : 'none' }
  } catch { return defaultTypography }
}

/** Disposable typography/motion preview. Controls, persistence and CSS stay in the
 * standalone host; permanent row styling belongs to the incentive feature.
 */
export default function RowTweaks() {
  const fontId = useId()
  const animationId = useId()
  const [typography, setTypography] = useState<Typography>(savedTypography)

  useEffect(() => {
    try { localStorage.setItem(typographyKey, JSON.stringify(typography)) } catch { /* Preview remains usable. */ }
  }, [typography])

  const table = '[aria-label="Liquidity incentive offers"]'
  const heading = `${table} > [aria-hidden="true"]`
  const font = fonts.find(face => face.id === typography.font)
  // The feature owns the transparent heading and 4px gap in every build.
  // This optional control changes only label typography.
  const headingCss = typography.compactHeader ? `
    ${heading} > span { padding-top:8px; padding-bottom:8px; }
  ` : ''
  // A private family name confines local font loading to this preview. Existing
  // fonts, semantic colors and font sizes outside the table are left untouched.
  // APR values retain their approved Funnel Display 500 instead of preview overrides.
  const fontCss = font ? `
    @font-face { font-family:"Saffron tweak ${font.id}"; src:url("${font.src}") format("truetype"); font-weight:${font.weight}; font-display:swap; }
    ${table}, ${table} :not([data-incentive-apr]) { font-family:"Saffron tweak ${font.id}" !important; font-weight:${font.weight} !important; }
  ` : ''

  return <>
    <TableTypography $rules={headingCss + fontCss + aprAnimationCss(typography.aprAnimation)} />
    <Control>
      <summary>
        <svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' aria-hidden='true'>
          <path d='m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 1-3-3-2 1-3-3-2-3 1-2-2Z' />
          <circle cx='11.5' cy='11' r='3' />
        </svg>
        Tweak
      </summary>
      <Panel aria-label='Table styling tweaks'>
        <strong>Table styling</strong>
        <Highlight><input type='checkbox' checked={typography.compactHeader}
          onChange={event => setTypography(previous => ({ ...previous, compactHeader: event.target.checked }))} />
          Compact heading</Highlight>
        <small>Compact column labels.</small>
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
        <button type='button' onClick={() => { setTypography(defaultTypography) }}>Reset defaults</button>
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
  @media(max-width:1300px){right:16px;bottom:calc(var(--bottom-nav-height, 64px) + 16px);}
`
const Panel = styled.div`
  position:absolute;right:0;bottom:calc(100% + 10px);width:min(280px, calc(100vw - 32px));
  display:flex;flex-direction:column;gap:12px;padding:18px;border-radius:10px;
  max-height:calc(100dvh - 180px);overflow:auto;
  background:${({ theme }) => theme.colors.background.card};border:1px solid transparent;
  box-shadow:0 8px 28px rgba(0,0,0,.2);
  strong{font:500 17px ${({ theme }) => theme.fonts.display};}
  select,button{font:inherit;color:inherit;border:1px solid transparent;
    background:${({ theme }) => theme.colors.background.elevated};border-radius:6px;padding:10px;}
  button{cursor:pointer;}button[aria-pressed=true]{outline:2px solid ${({ theme }) => theme.colors.primary.saffron};}
  small{color:${({ theme }) => theme.colors.text.secondary};font-size:11px;}
`
const Highlight = styled.label`
  display:flex;align-items:center;gap:8px;cursor:pointer;
  input{accent-color:${({ theme }) => theme.colors.accent.gold};}
`
