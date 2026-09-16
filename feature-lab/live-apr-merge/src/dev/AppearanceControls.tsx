import { useId, type Dispatch, type SetStateAction } from 'react'
import styled from 'styled-components'
import { type SidebarAppearance } from '../host/sidebarTheme'
import { fonts, defaultTypography, type Typography } from './appearancePreferences'
import { aprAnimations, validAprAnimation } from './aprAnimations'
import SidebarTweaks from './SidebarTweaks'

/** Editor-only controls load on explicit opening, never on a returning visit.
 * Parent-owned preferences remain applied even when this component is absent. */
export default function AppearanceControls({typography,setTypography,appearance,setAppearance}: {
  typography: Typography; setTypography: Dispatch<SetStateAction<Typography>>;
  appearance: SidebarAppearance; setAppearance: Dispatch<SetStateAction<SidebarAppearance>>;
}) {
  const fontId=useId(), animationId=useId(), speedId=useId(), angleId=useId()
  const orbitSeconds=24/typography.orbitSpeed
  return (
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
        <SidebarTweaks appearance={appearance} setAppearance={setAppearance} />
        <small>Preview only. Saved in this browser.</small>
      </Panel>
  )
}
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
