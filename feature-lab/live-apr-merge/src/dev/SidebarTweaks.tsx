import { useId, type Dispatch, type SetStateAction } from 'react'
import styled from 'styled-components'
import { sidebarDefaults, type SidebarAppearance } from '../host/sidebarTheme'
import { applySidebarPreset, sidebarPresets } from './sidebarPresets'
import { colors, paintSliders, shapeSliders, orbitSlider, toggles } from './appearancePreferences'

/** Editor-only sidebar controls. First-paint styling and persistence belong to
 * the lightweight parent and do not depend on downloading this component. */
export default function SidebarTweaks({appearance,setAppearance}: {
  appearance: SidebarAppearance; setAppearance: Dispatch<SetStateAction<SidebarAppearance>>;
}) {
  const id=useId()
  // Reuse the same small slider renderer for paint, layout and optional motion.
  const slider = ([key, label, min, max, step, unit]: typeof paintSliders[number] | typeof shapeSliders[number] | typeof orbitSlider) =>
    <Slider key={key} htmlFor={`${id}-${key}`}>
      <span>{label} · {appearance[key]}{unit}</span>
      <input id={`${id}-${key}`} aria-label={label} type='range' min={min} max={max} step={step} value={appearance[key]}
        onChange={event => setAppearance(value => ({ ...value, [key]: Number(event.target.value) }))} />
    </Slider>
  return <>
    <Section>
      <summary>Sidebar appearance</summary>
      <Fields>
        <label htmlFor={`${id}-style`}>Button style</label>
        <select id={`${id}-style`} value={appearance.style}
          onChange={event => setAppearance(value => applySidebarPreset(value, event.target.value))}>
          {sidebarPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
        </select>
        <small>Styles apply to the selected button. Enable all buttons to extend the style.</small>
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
