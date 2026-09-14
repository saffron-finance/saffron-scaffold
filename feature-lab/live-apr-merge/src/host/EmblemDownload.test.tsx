import { Component, type ReactNode } from 'react'
import { cleanup, render, waitFor } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { Emblem3DLogo } from '../../vendor/fixed-income-ui/shared/components/emblem3d/Emblem3DLogo'

// Reject the real logo's lazy dependency, before any child onError can run.
vi.mock('../../vendor/fixed-income-ui/shared/components/emblem3d/Emblem3D', async () => {
  throw new Error('Decorative JavaScript download failed')
})
const escaped = vi.fn()
class OuterBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch() { escaped() }
  render() { return this.state.failed ? <p>App lost</p> : this.props.children }
}
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.restoreAllMocks() })

it('retains the real still and usable shell when the 3D JavaScript download rejects', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.stubGlobal('IntersectionObserver', class {
    constructor(private notify: (items: { isIntersecting: boolean }[]) => void) {}
    observe() { this.notify([{ isIntersecting: true }]) }
    disconnect() {}
  })
  vi.stubGlobal('requestIdleCallback', (fn: () => void) => window.setTimeout(fn, 0))
  vi.stubGlobal('cancelIdleCallback', (id: number) => window.clearTimeout(id))
  vi.stubGlobal('matchMedia', () => ({ matches: false }))
  const dom = render(<OuterBoundary><button>Other action</button><Emblem3DLogo /></OuterBoundary>)
  await waitFor(() => expect(dom.container.querySelector('[data-emblem-state="static"]')).not.toBeNull())
  expect(escaped).not.toHaveBeenCalled()
  expect(dom.getByRole('button', { name: 'Other action' })).toBeEnabled()
  const still = dom.container.querySelector('img')!
  expect(still.getAttribute('src')).toContain('emblem-still.png')
  expect(still.parentElement).toHaveStyle({ opacity: '1' })
})
