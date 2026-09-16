import { useEffect, useRef, useState } from 'react'
import styled, { ThemeProvider, useTheme } from 'styled-components'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'

// html-to-image/image decoders cannot always be interrupted. Keep one shared
// underlying job, even after its owner cancels, until that job really settles.
let pendingCapture: Promise<Blob> | null = null

/** Release the caller promptly on cancellation without leaving an abort listener. */
function cancellable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('Capture cancelled', 'AbortError'))
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort))
  })
}

/** Snapshot-only capture with immediate DOM teardown on timeout or owner loss.
 * An uninterruptible decoder may finish later, but cannot create another root. */
async function capturePool(content: ReactNode, signal: AbortSignal): Promise<Blob> {
  if (pendingCapture) throw new Error('The previous image capture is still finishing.')
  let host: HTMLDivElement | undefined, root: ReturnType<typeof createRoot> | undefined
  const cleanup = () => { root?.unmount(); root = undefined; host?.remove(); host = undefined }
  signal.addEventListener('abort', cleanup, { once: true })
  const work = (async () => {
    const { toBlob } = await import('html-to-image')
    signal.throwIfAborted()
    await document.fonts.ready
    signal.throwIfAborted()
    host = document.createElement('div')
    host.setAttribute('aria-hidden', 'true')
    host.dataset.aprCapture = ''
    host.inert = true
    Object.assign(host.style, { position: 'fixed', left: '-100000px', top: '0', pointerEvents: 'none' })
    // Position only the host, never the node html-to-image clones.
    const surface = document.createElement('div')
    Object.assign(surface.style, { width: '600px', boxSizing: 'border-box', padding: '14px', border: '1px solid #292929', background: '#000' })
    host.append(surface); document.body.append(host)
    root = createRoot(surface)
    flushSync(() => root!.render(content))
    await Promise.all([...host.querySelectorAll('img')].map(img => img.decode()))
    signal.throwIfAborted()
    const blob = await toBlob(surface, { backgroundColor: '#000', pixelRatio: 2, preferredFontFormat: 'woff2' })
    signal.throwIfAborted()
    if (!blob) throw new Error('PNG capture failed')
    return blob
  })()
  pendingCapture = work
  // Both handlers consume rejection, including completion after owner unmount.
  void work.then(() => { if (pendingCapture === work) pendingCapture = null },
    () => { if (pendingCapture === work) pendingCapture = null })
  try { return await cancellable(work, signal) }
  finally { signal.removeEventListener('abort', cleanup); cleanup() }
}

/** Start clipboard writing inside the click gesture (including Safari). The
 * PNG promise lets rendering finish later without losing clipboard activation. */
export function CopyPoolImageButton({
  poolName,
  renderCapture,
}: {
  poolName: string
  renderCapture: () => ReactNode
}) {
  const theme = useTheme()
  const [state, setState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle')
  const [message, setMessage] = useState('')
  const captureOwner = useRef<AbortController | null>(null)
  useEffect(() => () => { const owner = captureOwner.current; captureOwner.current = null; owner?.abort() }, [])
  useEffect(() => {
    if (state !== 'copied' && state !== 'error') return
    const timer = window.setTimeout(() => {
      setState('idle')
      setMessage('')
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async () => {
    if (captureOwner.current) return
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      setState('error')
      setMessage('PNG clipboard copying is not supported in this browser.')
      return
    }
    const owner = new AbortController()
    captureOwner.current = owner
    const deadline = window.setTimeout(() => owner.abort(), 15_000)
    setState('copying')
    setMessage('Copying PNG…')
    try {
      const png = capturePool(<ThemeProvider theme={theme}>{renderCapture()}</ThemeProvider>, owner.signal)
      // Handle a rendering failure even if clipboard permission fails first.
      void png.catch(() => {})
      await cancellable(navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]), owner.signal)
      if (captureOwner.current !== owner) return
      setState('copied')
      setMessage('PNG copied')
    } catch (error) {
      owner.abort() // Permission failure must also release stalled rendering.
      if (captureOwner.current !== owner) return
      // A name/message diagnosis is useful for browser permission/rendering failures.
      console.warn('APR PNG capture failed', error instanceof Error ? error.message : 'unknown')
      setState('error')
      setMessage('Could not copy PNG. Allow clipboard access and try again.')
    } finally {
      window.clearTimeout(deadline)
      owner.abort()
      if (captureOwner.current === owner) captureOwner.current = null
    }
  }

  return (
    <Control data-png-exclude>
      <Button
        type='button'
        aria-label={`Copy ${poolName} as PNG`}
        title='Copy pair as PNG'
        aria-busy={state === 'copying'}
        disabled={state === 'copying'}
        onClick={() => void copy()}
      >
        <svg
          width='18'
          height='20'
          viewBox='0 0 24 24'
          fill='none'
          stroke='currentColor'
          strokeWidth='1.6'
          aria-hidden='true'
        >
          {state === 'copied' ? (
            <path d='m5 12 4 4L19 6' />
          ) : (
            <>
              <path d='M14 2H5v20h14V7z' />
              <path d='M14 2v6h5' />
            </>
          )}
        </svg>
      </Button>
      {message && <Feedback role='status'>{message}</Feedback>}
    </Control>
  )
}

const Control = styled.span`
  position: relative;
  display: inline-flex;
`
const Button = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid #555;
  border-radius: 0;
  background: #080808;
  color: #ddd;
  cursor: pointer;
  &:hover {
    color: #fff;
    border-color: #aaa;
  }
  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
  &:disabled {
    cursor: wait;
    opacity: 0.6;
  }
`
const Feedback = styled.span`
  position: absolute;
  right: 0;
  top: 38px;
  z-index: 5;
  width: max-content;
  max-width: 200px;
  padding: 6px 8px;
  border: 1px solid #555;
  background: #080808;
  color: #fff;
  font: 12px/1.4 sans-serif;
  letter-spacing: normal;
`
