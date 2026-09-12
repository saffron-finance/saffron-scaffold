import { useEffect, useRef } from 'react'
import styled from 'styled-components'

import { EmblemScene } from './EmblemScene'
import { EmblemError, prefersReducedMotion } from './emblemStatic'

/**
 * React mount for {@link EmblemScene}. Fills its parent, so the caller sizes it.
 *
 * Never import this module eagerly — it pulls in three.js. `Emblem3DLogo` is the
 * public entry point and code-splits it away from the initial bundle.
 */

export interface Emblem3DProps {
  modelUrl: string
  matcapUrl: string
  noiseUrl?: string
  /** Spin rate around Y, in radians/second. */
  spinSpeed?: number
  /** Set false to pin the emblem's pose regardless of pointer position. */
  tilt?: boolean
  className?: string
  /** Fired once the emblem is on screen, so the caller can retire its fallback. */
  onReady?: () => void
  /** Fired if WebGL, the model or a texture is unavailable. */
  onError?: (error: unknown) => void
}

export function Emblem3D({
  modelUrl,
  matcapUrl,
  noiseUrl,
  spinSpeed,
  tilt = true,
  className,
  onReady,
  onError,
}: Emblem3DProps) {
  const sceneRef = useRef<EmblemScene>()
  const speedRef = useRef(spinSpeed)
  speedRef.current = spinSpeed
  useEffect(() => { sceneRef.current?.setSpinSpeed(spinSpeed) }, [spinSpeed])

  const containerRef = useRef<HTMLDivElement>(null)

  // Read callbacks through refs so a caller passing inline arrows doesn't tear
  // down and rebuild the WebGL context on every render.
  const onReadyRef = useRef(onReady)
  const onErrorRef = useRef(onError)
  onReadyRef.current = onReady
  onErrorRef.current = onError

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    let scene: EmblemScene | undefined
    let cancelled = false

    // Effects that outlive the async setup, registered once the scene exists.
    const teardown: Array<() => void> = []

    const reducedMotion = prefersReducedMotion()

    EmblemScene.create({
      container,
      modelUrl,
      matcapUrl,
      noiseUrl,
      spinSpeed,
      tiltStrength: tilt && !reducedMotion ? undefined : 0,
      onContextLost: () =>
        onErrorRef.current?.(new EmblemError('context-lost', 'WebGL context lost')),
    })
      .then((created) => {
        // Unmounted (or Strict Mode's double-invoke re-ran the effect) while the
        // assets were in flight — the context would otherwise leak.
        if (cancelled) {
          created.dispose()
          return
        }
        scene = created
        sceneRef.current = created
        created.setSpinSpeed(speedRef.current)

        // Paint on every resize, not just on the next animation frame: the
        // loop below is parked whenever the emblem is offscreen, the tab is
        // backgrounded, or the user prefers reduced motion, and in all three
        // cases a resize would otherwise leave the previous frame stretched
        // across the new buffer. The first call is also what guarantees the
        // canvas is never blank once the placeholder has faded out.
        const applySize = () => {
          const { width, height } = container.getBoundingClientRect()
          created.setSize(width, height)
          created.renderFrame()
        }
        applySize()

        const resizeObserver = new ResizeObserver(applySize)
        resizeObserver.observe(container)
        teardown.push(() => resizeObserver.disconnect())

        // Reduced motion still gets the emblem, just held still.
        if (reducedMotion) {
          onReadyRef.current?.()
          return
        }

        // Only animate while the logo is actually on screen and the tab is
        // focused — an idle nav logo should cost nothing.
        let visible = document.visibilityState === 'visible'
        let onScreen = true
        const sync = () => (visible && onScreen ? created.start() : created.stop())

        const handleVisibility = () => {
          visible = document.visibilityState === 'visible'
          sync()
        }
        document.addEventListener('visibilitychange', handleVisibility)
        teardown.push(() => document.removeEventListener('visibilitychange', handleVisibility))

        const intersectionObserver = new IntersectionObserver((entries) => {
          onScreen = entries.some((entry) => entry.isIntersecting)
          sync()
        })
        intersectionObserver.observe(container)
        teardown.push(() => intersectionObserver.disconnect())

        if (tilt) {
          // Pointer position across the viewport, matching the marketing site —
          // the emblem leans toward the cursor wherever it is on the page.
          const handlePointer = (event: PointerEvent) => {
            created.setPointer(
              (event.clientX / window.innerWidth) * 2 - 1,
              (event.clientY / window.innerHeight) * 2 - 1
            )
          }
          window.addEventListener('pointermove', handlePointer, { passive: true })
          teardown.push(() => window.removeEventListener('pointermove', handlePointer))
        }

        sync()
        onReadyRef.current?.()
      })
      .catch((error) => {
        if (!cancelled) onErrorRef.current?.(error)
      })

    return () => {
      cancelled = true
      teardown.forEach((fn) => fn())
      sceneRef.current = undefined
      scene?.dispose()
    }
  }, [modelUrl, matcapUrl, noiseUrl, tilt])

  // The canvas itself is created and owned by EmblemScene (see its docs) — this
  // div is only the mount point, so React never adopts a canvas across mounts.
  return <Mount ref={containerRef} className={className} aria-hidden='true' />
}

const Mount = styled.div`
  width: 100%;
  height: 100%;
`
