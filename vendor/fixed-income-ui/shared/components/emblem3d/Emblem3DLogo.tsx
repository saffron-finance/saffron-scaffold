import { ReactNode, Suspense, lazy, useEffect, useRef, useState } from 'react'
import styled from 'styled-components'

// Direct module path (not the src/analytics barrel) to avoid closing a
// src/shared -> src/analytics -> src/web3 -> src/shared import cycle, the same
// reason ErrorBoundary imports it this way.
import { posthog } from './previewTelemetry'

import {
  EmblemStaticReason,
  STUCK_AFTER_VISIBLE_MS,
  classifyEmblemFailure,
  emblemEnvironment,
  prefersReducedMotion,
  saveDataEnabled,
} from './emblemStatic'

/**
 * Public entry point for the 3D emblem.
 *
 * This module must NOT import three.js — it is what keeps the ~600 KB WebGL
 * bundle off the initial page load. It paints a still of the emblem
 * immediately, waits for the browser to go idle, then code-splits the real
 * canvas in and cross-fades to it. Anything that fails along the way (no
 * WebGL, asset 404, context loss) leaves the still in place.
 *
 * For the same reason it is deliberately absent from
 * `src/shared/components/index.ts` — importing it through that barrel would put
 * this file (and, in a bundler that can't see through the lazy boundary,
 * everything downstream of it) on every page's critical path. Import it by
 * path: `src/shared/components/emblem3d`.
 */

// Assets live under apps/frontend/public/gl/, copied from the marketing site
// (saffron-website `public/gl/`): the emblem mesh verbatim, the matcap
// downsampled 1280 -> 256 and the blue noise centre-cropped 256 -> 128 (a
// resample would smear the noise spectrum that makes the dither work).
const MODEL_URL = `${import.meta.env.BASE_URL}gl/emblem.glb`
const MATCAP_URL = `${import.meta.env.BASE_URL}gl/emblem-matcap.jpg`
const NOISE_URL = `${import.meta.env.BASE_URL}gl/blue-noise.png`

// The placeholder is a render of the emblem's OWN first frame, at the pose the
// live canvas starts from, so the swap is invisible. Anything else — a flat
// mark, a different silhouette — pops on every reload, which is the whole
// reason this exists rather than reusing the app's SVG logo.
//
// It is therefore GENERATED, and goes stale if the emblem's appearance changes.
// Change the base pose, the matcap, or colorBoost / noiseFactor / scaleFactor in
// EmblemScene.ts and this file must be regenerated.
//
// The scenario that regenerated it (examples/emblem-still-capture.mjs) was
// REMOVED on 2026-09-04: it wrote straight over this tracked asset, so any
// broad run of the headless suite silently dirtied the working tree and the
// change could be swept into an unrelated commit. Regenerating is a manual
// step now — screenshot the mounted canvas at the nav logo's box and replace
// this file. `examples/emblem-still-swap.mjs` still checks the handover
// (that the still lines up with the canvas's first frame) once you have.
const STILL_URL = `${import.meta.env.BASE_URL}gl/emblem-still.png`

const Emblem3D = lazy(() => import('./Emblem3D').then((m) => ({ default: m.Emblem3D })))

/**
 * Report — once per page load — how the emblem ended up.
 *
 * Every branch that ends in a static emblem is otherwise invisible: the
 * fallback is a render of the emblem itself, so a dead WebGL path and a live
 * canvas look the same to the eye and to a bug report.
 *
 * Both outcomes are reported, not just the bad one. With only `emblem_static`
 * on the wire there is no denominator, and a count of it means nothing on its
 * own: ten 'reduced-motion' events could be ten users who asked for less
 * motion, or every user the app has — and those call for opposite fixes.
 * `emblem_animating` supplies the denominator. Exactly one of the two is
 * emitted per page load, so the static rate is a ratio of two counts rather
 * than a count divided by a guess at how many people saw the nav.
 *
 * Module-level rather than per-component: the nav remounts on some route
 * changes and the answer would be identical every time. `git_sha` is already a
 * registered super-property (see posthog.ts), so the build is on every event.
 */
let reported = false

type EmblemOutcome = 'emblem_static' | 'emblem_animating'

function report(event: EmblemOutcome, properties?: Record<string, unknown>) {
  if (reported) return
  reported = true
  posthog.capture(event, { ...properties, ...emblemEnvironment() })
}

const reportStatic = (reason: EmblemStaticReason) => report('emblem_static', { reason })

const reportAnimating = () => report('emblem_animating')

export interface Emblem3DLogoProps {
  /**
   * Overrides the placeholder shown until the canvas is live (and left in
   * place permanently if it can't be). Defaults to the emblem still, which is
   * almost always what you want — a different mark here reintroduces the flash
   * on load.
   */
  fallback?: ReactNode
  /** Spin rate around Y, in radians/second. */
  spinSpeed?: number
  /** Set false to pin the emblem's pose regardless of pointer position. */
  tilt?: boolean
  className?: string
}

export function Emblem3DLogo({ fallback, spinSpeed, tilt, className }: Emblem3DLogoProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const [shouldLoad, setShouldLoad] = useState(false)
  const [ready, setReady] = useState(false)
  const [failed, setFailed] = useState(false)

  // Read at fire time, not closed over: making it a dependency below would
  // restart the countdown the moment scheduling flipped, giving the emblem two
  // full timeouts instead of one.
  const shouldLoadRef = useRef(shouldLoad)
  shouldLoadRef.current = shouldLoad

  // Watchdog for the silent branches. Everything else here reports because
  // something threw; this covers the emblem simply never arriving — the
  // IntersectionObserver that never fires in a tab that is never painted, an
  // idle callback that never runs, a fetch that hangs without ever rejecting.
  // Those leave the user looking at the fallback with nothing on the wire.
  useEffect(() => {
    if (ready) return

    // Only counts down while the page is visible, so a tab nobody looked at is
    // never blamed. Pausing keeps the remaining budget rather than restarting.
    let remaining = STUCK_AFTER_VISIBLE_MS
    let startedAt = 0
    let timer: number | undefined

    const resume = () => {
      if (timer !== undefined) return
      startedAt = Date.now()
      timer = window.setTimeout(() => {
        // An unrendered logo is not a stuck one. `display: none` never
        // intersects, so a silent observer on a hidden instance is the
        // optimization working as intended — reporting it would bill those
        // pageviews as defects and bury the real signal.
        if (!stageRef.current?.getClientRects().length) return

        // reportStatic dedupes, so an error that already reported wins.
        reportStatic(shouldLoadRef.current ? 'load-stalled' : 'never-scheduled')
      }, remaining)
    }

    const pause = () => {
      if (timer === undefined) return
      window.clearTimeout(timer)
      timer = undefined
      remaining = Math.max(0, remaining - (Date.now() - startedAt))
    }

    const sync = () => (document.visibilityState === 'visible' ? resume() : pause())

    sync()
    document.addEventListener('visibilitychange', sync)
    return () => {
      document.removeEventListener('visibilitychange', sync)
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [ready])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return

    // Respect an explicit data-saver preference — a decorative logo is not
    // worth a metered download.
    if (saveDataEnabled()) {
      reportStatic('save-data')
      return
    }

    let idleHandle: number | undefined
    let timeoutHandle: number | undefined

    const cancelIdle = () => {
      if (idleHandle !== undefined) window.cancelIdleCallback(idleHandle)
      if (timeoutHandle !== undefined) window.clearTimeout(timeoutHandle)
    }

    const scheduleLoad = () => {
      // requestIdleCallback is still unimplemented in Safari; the timeout is
      // the fallback there and the ceiling everywhere else.
      if (typeof window.requestIdleCallback === 'function') {
        idleHandle = window.requestIdleCallback(() => setShouldLoad(true), { timeout: 3000 })
      } else {
        timeoutHandle = window.setTimeout(() => setShouldLoad(true), 1200)
      }
    }

    // Wait until the logo is actually laid out and on screen. This is what
    // keeps the WebGL chunk and its ~160 KB of assets off pages where the
    // logo never renders or scrolls into view (`display: none` never
    // intersects).
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return
      observer.disconnect()
      scheduleLoad()
    })
    observer.observe(stage)

    return () => {
      observer.disconnect()
      cancelIdle()
    }
  }, [])

  const showCanvas = shouldLoad && !failed

  return (
    <Stage ref={stageRef} className={className}>
      <Layer $visible={!ready}>{fallback ?? <Still src={STILL_URL} alt='' aria-hidden='true' />}</Layer>
      {showCanvas && (
        <Layer $visible={ready}>
          <Suspense fallback={null}>
            <Emblem3D
              modelUrl={MODEL_URL}
              matcapUrl={MATCAP_URL}
              noiseUrl={NOISE_URL}
              spinSpeed={spinSpeed}
              tilt={tilt}
              onReady={() => {
                setReady(true)
                // The canvas is live but Emblem3D parks the loop and pins the
                // tilt under reduced motion, so this is still a static emblem —
                // and the only branch that reaches the user as one WITHOUT the
                // fallback still behind it.
                if (prefersReducedMotion()) reportStatic('reduced-motion')
                // Otherwise the emblem is healthy and the loop is Emblem3D's to
                // run: it parks offscreen and in a backgrounded tab BY DESIGN,
                // so this reports a working emblem, not a spinning one.
                else reportAnimating()
              }}
              onError={(error) => {
                setFailed(true)
                setReady(false)
                reportStatic(classifyEmblemFailure(error))
              }}
            />
          </Suspense>
        </Layer>
      )}
    </Stage>
  )
}

const Stage = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
`

// Both layers are stacked so the cross-fade doesn't reflow the nav. The fade is
// short because the two layers show the same emblem at the same pose — it only
// has to cover the handover, not disguise a change of image.
const Layer = styled.div<{ $visible: boolean }>`
  position: absolute;
  inset: 0;
  opacity: ${(props) => (props.$visible ? 1 : 0)};
  transition: opacity 0.2s ease;
  pointer-events: none;

  > * {
    width: 100%;
    height: 100%;
  }
`

const Still = styled.img`
  object-fit: contain;
`
