import { cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ThemeProvider } from 'styled-components'
import { darkTheme } from 'src/shared/styles/themes/darkTheme'
import { toBlob } from 'html-to-image'
import { CopyPoolImageButton } from './CopyPoolImageButton'

vi.mock('html-to-image', () => ({ toBlob: vi.fn() }))
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

/** Clipboard activation is claimed synchronously, before asynchronous rendering,
 * and capture is limited to the clicked tile rather than neighboring pools. */
it('writes a deferred PNG to the clipboard for only the selected pool', async () => {
  Object.defineProperty(document, 'fonts', {
    configurable: true,
    value: { ready: Promise.resolve() },
  })
  Object.defineProperty(HTMLImageElement.prototype, 'decode', {
    configurable: true,
    value: vi.fn().mockResolvedValue(undefined),
  })
  let resolve!: (blob: Blob) => void
  vi.mocked(toBlob).mockReturnValue(
    new Promise((done) => {
      resolve = done
    })
  )
  const write = vi.fn(async (items: any[]) => {
    await items[0].data['image/png']
  })
  vi.stubGlobal('navigator', { clipboard: { write } })
  vi.stubGlobal(
    'ClipboardItem',
    class {
      constructor(public data: Record<string, Promise<Blob>>) {}
    }
  )
  const capture = (id: string) => () =>
    (
      <section data-pool-id={id}>
        <span data-png-brand>saffron.finance</span>
        <p data-testid='tracking-paused'>Tracking paused</p>
      </section>
    )
  const dom = render(
    <ThemeProvider theme={darkTheme}>
      <section data-pool-id='first'>
        <CopyPoolImageButton poolName='First' renderCapture={() => <div>First</div>} />
      </section>
      <section data-pool-id='second'>
        <CopyPoolImageButton poolName='Second' renderCapture={capture('second')} />
        <div data-testid='app-surface'>
          <div data-testid='pool-status-section'>Page open</div>
          <div data-testid='pool-details'>Expanded history</div>
          <p data-testid='tracking-paused'>Tracking paused</p>
        </div>
      </section>
    </ThemeProvider>
  )
  fireEvent.click(dom.getByRole('button', { name: 'Copy Second as PNG' }))
  expect(write).toHaveBeenCalledTimes(1)
  expect(dom.getByRole('button', { name: 'Copy Second as PNG' })).toBeDisabled()
  await waitFor(() => expect(toBlob).toHaveBeenCalledTimes(1))
  const exported = vi.mocked(toBlob).mock.calls[0][0]
  expect(exported).not.toBe(dom.container.querySelector('[data-pool-id="second"]'))
  expect(exported.querySelector('[data-pool-id]')?.getAttribute('data-pool-id')).toBe('second')
  expect(exported.querySelector('button')).toBeNull()
  expect(exported.querySelector('[data-png-brand]')?.textContent).toBe('saffron.finance')
  expect(exported.style.width).toBe('600px')
  expect(exported.querySelector('[data-testid="pool-status-section"]')).toBeNull()
  expect(exported.querySelector('[data-testid="pool-details"]')).toBeNull()
  expect(exported.querySelector('[data-testid="tracking-paused"]')).not.toBeNull()
  // Export compaction must not collapse the user's actual page.
  expect(dom.getByText('Expanded history')).toBeVisible()
  expect(dom.getByRole('button', { name: 'Copy Second as PNG' })).toBeInTheDocument()
  resolve(new Blob(['png-fixture'], { type: 'image/png' }))
  await waitFor(() => expect(dom.getByRole('status').textContent).toBe('PNG copied'))
  expect(document.querySelector('[data-png-brand]')).toBeNull()
})

/** Never claim success when the browser lacks image clipboard support. */
it('reports unavailable clipboard support without attempting a screenshot', () => {
  vi.mocked(toBlob).mockClear()
  vi.stubGlobal('navigator', {})
  const dom = render(
    <section>
      <CopyPoolImageButton poolName='First' renderCapture={() => <div>First</div>} />
    </section>
  )
  fireEvent.click(dom.getByRole('button', { name: 'Copy First as PNG' }))
  expect(dom.getByRole('status').textContent).toContain('not supported')
  expect(toBlob).not.toHaveBeenCalled()
})
