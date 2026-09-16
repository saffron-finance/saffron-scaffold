import './TooltipSurface.css'
import { type CSSProperties, type HTMLAttributes, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/** One lightweight, title-only tooltip for the compact rail. Links remain
 * links: hover/focus reveals help, and click/tap always follows the destination.
 * Closed tooltips do no DOM work, so build-generated warm templates stay safe.
 * Share visual rules with modal2 in TooltipSurface.css, not its checkout code.
 */
export function useSidebarTooltip(enabled: boolean, routeKey: string) {
  const [active, setActive] = useState<{ anchor: HTMLAnchorElement; label: string } | null>(null)
  const [position, setPosition] = useState<CSSProperties>({ visibility: 'hidden' })
  const bubble = useRef<HTMLSpanElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>()
  const id = useId()
  const cancelClose = useCallback(() => { clearTimeout(timer.current) }, [])
  const close = useCallback(() => { cancelClose(); setActive(null) }, [cancelClose])

  // Avoid flicker across icon edges; keyboard focus keeps its label readable.
  const leave = () => {
    cancelClose()
    if (active?.anchor === document.activeElement && active.anchor.matches(':focus-visible')) return
    timer.current = setTimeout(close, 100)
  }
  const show = (anchor: HTMLAnchorElement, label: string) => {
    if (!enabled) return
    cancelClose()
    setActive({ anchor, label })
  }
  useEffect(() => { close() }, [enabled, routeKey, close])
  useEffect(() => cancelClose, [cancelClose])
  useLayoutEffect(() => {
    if (!enabled || !active || !bubble.current) return
    // Portal outside the scrollable rail: even long titles remain unclipped.
    // Clamp the bubble to the viewport while the caret still points at the icon.
    const anchor = active.anchor.getBoundingClientRect()
    const bounds = bubble.current.getBoundingClientRect()
    const center = anchor.left + anchor.width / 2
    const left = Math.max(8, Math.min(center - bounds.width / 2, window.innerWidth - bounds.width - 8))
    setPosition({ left, top: Math.max(8, anchor.top - bounds.height - 8),
      '--caret-x': `${center - left - 1}px`, '--anchor-width': '20px' } as CSSProperties)
  }, [enabled, active])
  useEffect(() => {
    if (!enabled || !active) return
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault(); event.stopPropagation(); close()
    }
    // Dismiss instead of leaving a floating label detached from a moved icon.
    document.addEventListener('keydown', escape, true)
    document.addEventListener('pointerdown', close, true)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('keydown', escape, true)
      document.removeEventListener('pointerdown', close, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [enabled, active, close])

  /** Bind only discovery/dismissal events; never prevent link activation. */
  const linkProps = (label: string): HTMLAttributes<HTMLAnchorElement> => ({
    'aria-describedby': enabled && active?.label === label ? id : undefined,
    onPointerEnter: event => { if (event.pointerType === 'mouse') show(event.currentTarget, label) },
    onPointerLeave: leave,
    onFocus: event => { if (event.currentTarget.matches(':focus-visible')) show(event.currentTarget, label) },
    onBlur: close,
    onClick: close,
  })
  const tooltip = enabled && active ? createPortal(
    <span ref={bubble} id={id} role='tooltip' className='saffron-tooltip-surface saffron-rail-tooltip'
      style={position}>{active.label}</span>,
    document.body,
  ) : null
  return { linkProps, tooltip }
}
