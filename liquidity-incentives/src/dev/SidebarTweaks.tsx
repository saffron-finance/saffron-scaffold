import { useEffect, useId, useState } from 'react'
import styled, { createGlobalStyle } from 'styled-components'
import { sidebarDefaults, sidebarVariables, type SidebarAppearance } from '../host/sidebarTheme'
import { applySidebarPreset, sidebarOrbitCss, sidebarPreset, sidebarPresetCss, sidebarPresets } from './sidebarPresets'

const storageKey = 'saffron.staging.sidebar.v1'
const colors = [
  ['surfaceTop', 'Background top'], ['surfaceBottom', 'Background bottom'],
  ['gradientStart', 'Gradient start'], ['gradientMiddle', 'Gradient middle'], ['gradientEnd', 'Gradient end'],
  ['text', 'Navigation text'], ['selectedText', 'Highlighted text'],
] as const
// One definition drives slider bounds, accessible labels, and storage validation.
const paintSliders = [
  ['angle', 'Gradient direction', 0, 360, 15, '°'], ['surfaceAngle', 'Background direction', 0, 360, 15, '°'],
  ['strength', 'Highlight strength', 5, 100, 1, '%'], ['border', 'Border strength', 0, 100, 1, '%'],
  ['glow', 'Sidebar glow', 0, 60, 1, '%'], ['glowSpread', 'Glow spread', 0, 48, 1, 'px'],
] as const
const shapeSliders = [
  ['radius', 'Corner radius', 0, 24, 1, 'px'], ['padding', 'Button padding', 8, 18, 1, 'px'],
  ['gap', 'Row spacing', 0, 16, 1, 'px'], ['iconSize', 'Icon size', 16, 24, 1, 'px'],
] as const
const orbitSlider = ['orbitSpeed', 'Sidebar orbit speed', .25, 4, .25, '×'] as const
const toggles = [['tintAll', 'Style all buttons'], ['showIcons', 'Show icons'], ['indicator', 'Show active indicator']] as const

/** Restore only known presets, hex colors, booleans and bounded numbers.
 * Older saved palettes keep working; missing new controls use reference defaults. */
function savedAppearance(): SidebarAppearance {
  try {
    const stored = JSON.parse(localStorage.getItem(storageKey) || '{}'), result = { ...sidebarDefaults }
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

/** Browser-local sidebar editor. Presets supply a starting palette; subsequent
 * controls customize it without changing the APR, wallet, or request feature. */
export default function SidebarTweaks() {
  const id = useId()
  const [appearance, setAppearance] = useState<SidebarAppearance>(savedAppearance)
  useEffect(() => {
    try { localStorage.setItem(storageKey, JSON.stringify(appearance)) } catch { /* In-memory preview still works. */ }
  }, [appearance])
  // Reuse the same small slider renderer for paint, layout and optional motion.
  const slider = ([key, label, min, max, step, unit]: typeof paintSliders[number] | typeof shapeSliders[number] | typeof orbitSlider) =>
    <Slider key={key} htmlFor={`${id}-${key}`}>
      <span>{label} · {appearance[key]}{unit}</span>
      <input id={`${id}-${key}`} aria-label={label} type='range' min={min} max={max} step={step} value={appearance[key]}
        onChange={event => setAppearance(value => ({ ...value, [key]: Number(event.target.value) }))} />
    </Slider>
  return <>
    <Preview $variables={sidebarVariables(appearance) + sidebarPresetCss(appearance)} />
    <Section>
      <summary>Sidebar appearance</summary>
      <Fields>
        <label htmlFor={`${id}-style`}>Button style</label>
        <select id={`${id}-style`} value={appearance.style}
          onChange={event => setAppearance(value => applySidebarPreset(value, event.target.value))}>
          {sidebarPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
        <small>Styles apply to the selected button and hover. Enable all buttons for a full sunset menu.</small>
        <Toggle><input type='checkbox' checked={appearance.tintAll}
          onChange={event => setAppearance(value => ({ ...value, tintAll: event.target.checked }))} />Style all buttons</Toggle>
        {appearance.style === 'orbit' && <>{slider(orbitSlider)}<small>{Number((24 / appearance.orbitSpeed).toFixed(1))} seconds per orbit.</small></>}
        <Group><summary>Colors</summary><Fields>
          {colors.map(([key, label]) => <Color key={key}>
            <span>{label}</span><input aria-label={label} type='color' value={appearance[key]}
              onChange={event => setAppearance(value => ({ ...value, [key]: event.target.value }))} />
          </Color>)}
        </Fields></Group>
        <Group><summary>Gradient &amp; glow</summary><Fields>{paintSliders.map(slider)}</Fields></Group>
        <Group><summary>Shape &amp; spacing</summary><Fields>
          {shapeSliders.map(slider)}
          {toggles.slice(1).map(([key, label]) => <Toggle key={key}><input type='checkbox' checked={appearance[key]}
            onChange={event => setAppearance(value => ({ ...value, [key]: event.target.checked }))} />{label}</Toggle>)}
        </Fields></Group>
        <button type='button' onClick={() => setAppearance({ ...sidebarDefaults })}>Reset sidebar</button>
      </Fields>
    </Section>
  </>
}

// Higher specificity overrides the shell defaults, without affecting other UI.
const Preview = createGlobalStyle<{ $variables: string }>`
  [data-saffron-sidebar][data-saffron-sidebar]{${p => p.$variables}}
  ${sidebarOrbitCss}
`
const Section = styled.details`
  border-top:1px solid rgba(127,122,120,.25);padding-top:12px;
  summary{cursor:pointer;font-weight:500;padding:4px 0;}
`
const Fields = styled.div`display:flex;flex-direction:column;gap:12px;padding-top:12px;`
const Group = styled.details`summary{font-size:12px;color:${p => p.theme.colors.text.secondary};}`
const Slider = styled.label`display:flex;flex-direction:column;gap:8px;`
const Toggle = styled.label`display:flex;align-items:center;gap:8px;cursor:pointer;input{accent-color:#ffbc09;}`
const Color = styled.label`
  display:flex;align-items:center;justify-content:space-between;gap:12px;
  input[type=color]{width:44px;height:30px;padding:2px;border:1px solid rgba(127,122,120,.3);border-radius:4px;background:transparent;cursor:pointer;}
`
