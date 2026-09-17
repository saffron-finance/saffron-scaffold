import { afterEach, expect, it, vi } from 'vitest'
import { liveAprApiBase, SummaryClient, validateAprApiBase } from './summary-client'
afterEach(() => { delete window.__SAFFRON_LIVE_APR__; vi.unstubAllEnvs() })
it('SEC-URL-003 APR runtime override rejects other origins before any fetch allocation', () => {
  const fetcher = vi.fn()
  for (const api of ['https://example.invalid/api', '//example.invalid/api', 'javascript:alert(1)', 'data:text/html,authority', 'https://user:pass@example.invalid/api']) {
    expect(() => new SummaryClient('cashcat-eth-1', {api,fetcher})).toThrow('same-origin')
  }
  expect(fetcher).not.toHaveBeenCalled()
})
it('API query and fragment cannot alter how control subpaths are appended', () => {
  expect(() => validateAprApiBase('/api?redirect=https://example.invalid')).toThrow()
  expect(() => validateAprApiBase('/api#ignored')).toThrow()
})
it('configured same-origin mount and relative default remain portable', () => {
  window.__SAFFRON_LIVE_APR__ = {apiBase:'/nested/public-apr/'}
  expect(liveAprApiBase()).toBe('/nested/public-apr')
  expect(validateAprApiBase(window.location.origin + '/nested/api/')).toBe('/nested/api')
})
it('SEC-URL-004 admission control requests refuse redirects at the fetch boundary', async () => {
  let request: RequestInit | undefined
  const client = new SummaryClient('cashcat-eth-1', {api:'/api',fetcher:vi.fn(async (_url,init) => {request=init;throw new TypeError('Redirect refused')})})
  try { client.start(); await vi.waitFor(() => expect(request).toBeDefined()); expect(request!.redirect).toBe('error') }
  finally {client.stop(true)}
})
