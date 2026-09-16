import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import styled from 'styled-components'
import { RenderBoundary } from '../host/RenderBoundary'
import { typographyKey, storageKey, defaultsVersion, savedTypography, savedAppearance, appearanceCss } from './appearancePreferences'

const AppearanceControls = lazy(() => import('./AppearanceControls'))

/** Restore validated styling before the first row paint, but do not construct
 * the hidden editor tree. Its state lives here so close/reopen never loses it. */
export default function RowTweaks() {
  const [typography,setTypography]=useState(savedTypography)
  const [appearance,setAppearance]=useState(savedAppearance)
  const [open,setOpen]=useState(false)
  const rules=useMemo(()=>appearanceCss(typography,appearance),[typography,appearance])
  useEffect(()=>{
    try {localStorage.setItem(typographyKey,JSON.stringify({...typography,aprDefaultVersion:1,comingSoonDefaultVersion:1}))} catch {/* Storage is optional. */}
  },[typography])
  useEffect(()=>{
    try {localStorage.setItem(storageKey,JSON.stringify({...appearance,defaultsVersion}))} catch {/* Storage is optional. */}
  },[appearance])
  return <>
    {/* Plain validated CSS avoids regenerating a global styled-components sheet. */}
    <style data-saffron-appearance>{rules}</style>
    <Control onToggle={event=>setOpen(event.currentTarget.open)}>
      <summary>
        <svg width='17' height='17' viewBox='0 0 24 24' fill='none' stroke='currentColor' strokeWidth='1.6' aria-hidden='true'>
          <path d='m9 3-1 3-3 1-2 3 2 2-1 3 3 2 3-1 2 3 3-1 1-3 3-1 1-3-3-2 1-3-3-2-3 1-2-2Z' />
          <circle cx='11.5' cy='11' r='3' />
        </svg>
        Tweak
      </summary>
      {open && <RenderBoundary fallback={<p role='alert'>Appearance controls could not load. Reload to retry.</p>}>
        <Suspense fallback={<p role='status'>Opening appearance controls…</p>}>
          <AppearanceControls typography={typography} setTypography={setTypography} appearance={appearance} setAppearance={setAppearance}/>
        </Suspense>
      </RenderBoundary>}
    </Control>
  </>
}

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
