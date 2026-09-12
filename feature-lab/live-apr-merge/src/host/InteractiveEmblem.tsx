import { useEffect, useRef, useState } from 'react'
import styled from 'styled-components'
import { Emblem3DLogo } from '@fixed/shared/components/emblem3d/Emblem3DLogo'

const BASE_SPEED = 0.25
const BOOST = 3
const DECAY_MS = 1000

/** Decorative, keyboard-operable logo. Clicks add to the remaining boost;
 * quadratic decay reaches normal speed one second after the last click.
 * Closing cancels the frame loop; upstream still honors reduced motion. */
export function InteractiveEmblem() {
  const [speed, setSpeed] = useState(BASE_SPEED)
  const spin = useRef({ boost: 0, started: 0, frame: 0 })
  useEffect(() => () => cancelAnimationFrame(spin.current.frame), [])

  function accelerate() {
    const state = spin.current
    const now = performance.now()
    // Use elapsed time, not frame count: rapid clicks stack without a jump,
    // and a backgrounded tab resumes at the correctly decayed speed.
    const remaining = Math.max(0, 1 - (now - state.started) / DECAY_MS)
    state.boost = state.boost * remaining ** 2 + BOOST
    state.started = now
    cancelAnimationFrame(state.frame)
    setSpeed(BASE_SPEED + state.boost)
    const tick = (time: number) => {
      // A frame timestamp can slightly precede the click within that frame.
      const left = Math.min(1, Math.max(0, 1 - (time - state.started) / DECAY_MS))
      setSpeed(BASE_SPEED + state.boost * left ** 2)
      state.frame = left > 0 ? requestAnimationFrame(tick) : 0
    }
    state.frame = requestAnimationFrame(tick)
  }

  return <SpinButton type='button' aria-label='Spin Saffron faster' title='Click to spin faster'
    onClick={accelerate}>
    <Emblem3DLogo spinSpeed={speed} />
  </SpinButton>
}

const SpinButton = styled.button`
  width:48px;height:48px;flex-shrink:0;align-self:flex-end;margin-bottom:9px;padding:0;border:0;background:none;
  cursor:pointer;border-radius:8px;
  &:focus-visible{outline:2px solid ${({ theme }) => theme.colors.accent.gold};outline-offset:4px;}
`
