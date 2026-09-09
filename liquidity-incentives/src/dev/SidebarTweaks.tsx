import { useEffect, useId, useState } from 'react'
import styled, { createGlobalStyle } from 'styled-components'
import { sidebarDefaults, sidebarVariables, type SidebarAppearance } from '../host/sidebarTheme'

const storageKey = 'saffron.staging.sidebar.v1'
const colors = [
  ['surfaceTop', 'Background top'], ['surfaceBottom', 'Background bottom'],
  ['gradientStart', 'Gradient start'], ['gradientEnd', 'Gradient end'], ['text', 'Navigation text'],
] as const

/** Allow only hex colors and bounded numbers to cross the storage/CSS boundary. */
function savedAppearance(): SidebarAppearance {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '{}')
    const result = { ...sidebarDefaults }
    for (const [key] of colors) if (typeof stored?.[key] === 'string' && /^#[0-9a-f]{6}$/i.test(stored[key])) result[key] = stored[key]
    for (const [key, max] of [['angle', 360], ['glow', 60]] as const) {
      if (typeof stored?.[key] === 'number' && Number.isFinite(stored[key]) && stored[key] >= 0 && stored[key] <= max) result[key] = stored[key]
    }
    return result
  } catch { return { ...sidebarDefaults } }
}

/** Optional, browser-local appearance preview. Overrides are scoped to the
 * sidebar; APR colors, wallet dialogs and the underlying data never change. */
export default function SidebarTweaks() {
  const id = useId()
  const [appearance, setAppearance] = useState<SidebarAppearance>(savedAppearance)
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(appearance)) } catch { /* In-memory preview still works. */ }
  }, [appearance])
  return <>
    <Preview $variables={sidebarVariables(appearance)} />
    <Section>
      <summary>Sidebar appearance</summary>
      <Fields>
        {colors.map(([key, label]) => <Color key={key}>
          <span>{label}</span><input aria-label={label} type='color' value={appearance[key]}
            onChange={event => setAppearance(value => ({ ...value, [key]: event.target.value }))} />
        </Color>)}
        <label htmlFor={`${id}-angle`}>Gradient direction · {appearance.angle}°</label>
        <input id={`${id}-angle`} aria-label='Sidebar gradient direction' type='range' min='0' max='360' step='15' value={appearance.angle}
          onChange={event => setAppearance(value => ({ ...value, angle: Number(event.target.value) }))} />
        <label htmlFor={`${id}-glow`}>Glow · {appearance.glow}%</label>
        <input id={`${id}-glow`} aria-label='Sidebar glow' type='range' min='0' max='60' step='1' value={appearance.glow}
          onChange={event => setAppearance(value => ({ ...value, glow: Number(event.target.value) }))} />
        <button type='button' onClick={() => setAppearance({ ...sidebarDefaults })}>Reset sidebar</button>
      </Fields>
    </Section>
  </>
}

// Extra selector specificity overrides the shell defaults without !important.
const Preview = createGlobalStyle<{ $variables: string }>`[data-saffron-sidebar][data-saffron-sidebar]{${p => p.$variables}}`
const Section = styled.details`
  border-top:1px solid rgba(127,122,120,.25);padding-top:12px;
  summary{cursor:pointer;font-weight:500;padding:4px 0;}
`
const Fields = styled.div`display:flex;flex-direction:column;gap:12px;padding-top:12px;`
const Color = styled.label`
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  input[type=color]{width:44px;height:30px;padding:2px;border:1px solid rgba(127,122,120,.3);border-radius:4px;background:transparent;cursor:pointer;}
`
