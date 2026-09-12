import { useEffect, useState } from 'react'
import styled, { ThemeProvider, useTheme } from 'styled-components'
import type { ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'

/** Render the shared presentation in a detached compact surface. This code
 * owns no session/controller; every value is a snapshot of the clicked card. */
async function capturePool(content: ReactNode): Promise<Blob> {
  const { toBlob } = await import('html-to-image')
  await document.fonts.ready
  const host = document.createElement('div')
  host.setAttribute('aria-hidden', 'true')
  host.inert = true
  Object.assign(host.style, {
    position: 'fixed',
    left: '-100000px',
    top: '0',
    pointerEvents: 'none',
  })
  // Keep offscreen positioning outside the captured node: cloning that offset
  // into the PNG would place the card outside its own canvas.
  const surface = document.createElement('div')
  Object.assign(surface.style, {
    width: '600px',
    boxSizing: 'border-box',
    padding: '14px',
    border: '1px solid #292929',
    background: '#000',
  })
  host.append(surface)
  document.body.append(host)
  const root = createRoot(surface)
  try {
    flushSync(() => root.render(content))
    await Promise.all([...host.querySelectorAll('img')].map((img) => img.decode()))
    const blob = await toBlob(surface, {
      backgroundColor: '#000',
      pixelRatio: 2,
      preferredFontFormat: 'woff2',
    })
    if (!blob) throw new Error('PNG capture failed')
    return blob
  } finally {
    root.unmount()
    host.remove()
  }
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
  useEffect(() => {
    if (state !== 'copied' && state !== 'error') return
    const timer = window.setTimeout(() => {
      setState('idle')
      setMessage('')
    }, 5000)
    return () => window.clearTimeout(timer)
  }, [state])

  const copy = async (button: HTMLButtonElement) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
      setState('error')
      setMessage('PNG clipboard copying is not supported in this browser.')
      return
    }
    setState('copying')
    setMessage('Copying PNG…')
    try {
      const png = capturePool(<ThemeProvider theme={theme}>{renderCapture()}</ThemeProvider>)
      // Handle a rendering failure even if clipboard permission fails first.
      void png.catch(() => {})
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })])
      setState('copied')
      setMessage('PNG copied')
    } catch (error) {
      // A name/message diagnosis is useful for browser permission/rendering failures.
      console.warn('APR PNG capture failed', error instanceof Error ? error.message : 'unknown')
      setState('error')
      setMessage('Could not copy PNG. Allow clipboard access and try again.')
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
        onClick={(event) => void copy(event.currentTarget)}
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
