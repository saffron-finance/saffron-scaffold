import { lazy, Suspense, useEffect } from 'react'
import { cleanup, render } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { RenderBoundary, RootBoundary } from './RenderBoundary'

afterEach(() => { cleanup(); vi.restoreAllMocks() })

/** Shell failures include effects as well as initial render. Neither path may
 * erase durable wallet recovery or require a router/theme to render fallback. */
it.each(['render', 'effect'])('recovers a shell %s failure without clearing storage', async phase => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  localStorage.setItem('recovery-test', 'pending transaction')
  function Broken() {
    useEffect(() => { if (phase === 'effect') throw new Error('Shell effect failed') }, [])
    if (phase === 'render') throw new Error('Shell render failed')
    return <p>Shell</p>
  }
  const dom = render(<RootBoundary><Broken /></RootBoundary>)
  expect(await dom.findByRole('heading', { name: 'Saffron could not load' })).toBeVisible()
  expect(dom.getByRole('button', { name: 'Reload page' })).toBeEnabled()
  expect(localStorage.getItem('recovery-test')).toBe('pending transaction')
  localStorage.removeItem('recovery-test')
})

it('contains rejected optional imports without replacing their siblings', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  const Optional = lazy(async () => { throw new Error('Optional download failed') })
  const dom = render(<RootBoundary><button>Connect wallet</button>
    <RenderBoundary fallback={<span>Optional unavailable</span>}><Suspense><Optional /></Suspense></RenderBoundary>
  </RootBoundary>)
  expect(await dom.findByText('Optional unavailable')).toBeVisible()
  expect(dom.getByRole('button', { name: 'Connect wallet' })).toBeEnabled()
  expect(dom.queryByText('Saffron could not load')).toBeNull()
})
