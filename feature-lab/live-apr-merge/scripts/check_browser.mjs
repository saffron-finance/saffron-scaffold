import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { chromium, expect } from '@playwright/test'
import { checkArguments, checkDeployment } from './check_live.mjs'

/** Run through the intended host, with its existing access session if needed.
 * The isolated browser has no wallet, no operator login and no granted clipboard
 * permissions. Only checkout capability and APR observation sessions are issued. */
export async function smokeBrowser(target, { storageState, requireApr = false, checkClipboard = false,
  viewport = { width: 1440, height: 1000 }, ...options } = {}) {
  target = new URL(target)
  const browser = await chromium.launch({ headless: true })
  try {
    const context = await browser.newContext({ storageState, viewport })
    assert(!(await context.cookies()).some(cookie => cookie.name.startsWith('saffron_incentives_')),
      'Use a hosting-only session without an application wallet/operator login')
    const request = async (path, config = {}) => {
      const response = await context.request.fetch(new URL(path, target).href, { method: config.method ?? 'GET',
        headers: config.headers, data: config.body, maxRedirects: 0, timeout: 25000 })
      return new Response(await response.body(), { status: response.status(), headers: response.headers() })
    }
    const preflight = await checkDeployment(target, { ...options, request })
    const page = await context.newPage(), errors = [], assetFailures = []
    page.setDefaultTimeout(20000)
    page.on('pageerror', error => errors.push(error.message))
    page.on('response', response => {
      const path = new URL(response.url()).pathname
      if (path.startsWith(target.pathname + 'assets/') && response.status() >= 400) assetFailures.push(response.status())
    })
    // Streaming response headers alone do not prove the proxy flushes data.
    const cdp = await context.newCDPSession(page), streams = new Map()
    await cdp.send('Network.enable')
    cdp.on('Network.responseReceived', event => {
      if (event.response.mimeType === 'text/event-stream' && event.response.status === 200)
        streams.set(event.requestId, { chunks: 0, first: null, last: null, closed: false })
    })
    cdp.on('Network.dataReceived', event => {
      const stream = streams.get(event.requestId)
      if (stream && event.dataLength > 0) { stream.chunks++; stream.first ??= event.timestamp; stream.last = event.timestamp }
    })
    for (const name of ['Network.loadingFinished', 'Network.loadingFailed'])
      cdp.on(name, event => { const stream = streams.get(event.requestId); if (stream) stream.closed = true })
    await page.goto(target.href, { waitUntil: 'domcontentloaded' })
    const nav = name => page.getByRole('link', { name, exact: true })
    await expect(nav('Home')).toBeVisible()
    // Browser-issued Origin and HttpOnly path-scoped cookie must survive the
    // actual proxy. This creates no fee quote, payment or deployment request.
    const capability = await page.evaluate(async pathname => {
      const response = await fetch(pathname + 'api/incentives/checkout/session', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', credentials: 'same-origin',
      })
      return { status: response.status, ready: response.ok ? (await response.json()).ready : false }
    }, target.pathname)
    assert.deepEqual(capability, { status: 200, ready: true })
    const cookie = (await context.cookies()).find(item => item.name.startsWith('saffron_checkout_'))
    assert(cookie?.httpOnly && cookie.sameSite === 'Strict' && cookie.path === target.pathname + 'api/incentives', 'Checkout cookie scope or attributes changed')
    if (target.protocol === 'https:') assert(cookie.secure, 'HTTPS checkout cookie must be Secure')
    assert([401, 403].includes((await request('api/incentives/admin/status')).status), 'Checkout capability must not authenticate an operator')
    await nav('Portfolio').click(); await expect(page).toHaveURL(new URL('portfolio/vaults', target).href)
    await nav('Live APR').click(); await expect(page.getByTestId('live-apr').first()).toBeVisible()
    const apr = page.getByTestId('live-apr').first()
    await expect.poll(async () => /unavailable|%/i.test(await apr.innerText()), { timeout: 25000 }).toBe(true)
    if (requireApr) {
      await expect.poll(() => [...streams.values()].some(stream => !stream.closed && stream.chunks >= 2
        && stream.last - stream.first >= 1), { timeout: 25000 }).toBe(true)
      await expect(apr).not.toContainText(/unavailable/i)
    }
    const aprText = await apr.innerText(), streamEvidence = [...streams.values()].map(stream => ({
      chunks: stream.chunks, durationSeconds: stream.last == null ? 0 : stream.last - stream.first, closed: stream.closed,
    }))
    const clipboard = await page.evaluate(async () => ({
      secureContext: isSecureContext, pngSupported: Boolean(navigator.clipboard?.write && typeof ClipboardItem !== 'undefined'),
      permission: await navigator.permissions.query({ name: 'clipboard-write' }).then(value => value.state).catch(() => 'unavailable'),
    }))
    if (checkClipboard) {
      await page.getByRole('button', { name: /^Copy .* as PNG$/ }).first().click()
      const result = page.getByText(/^(PNG copied|Could not copy PNG\.|PNG clipboard copying is not supported)/)
      await expect(result).toBeVisible(); clipboard.result = await result.innerText()
    } else clipboard.result = 'Not exercised; no permission was granted by this check'
    await nav('Home').click()
    assert.deepEqual(assetFailures, [], 'A browser asset failed to load')
    assert.deepEqual(errors, [], 'Browser runtime errors')
    return { ...preflight, browserSmoke: true, mount: target.pathname, viewport, walletConnected: false,
      checkoutCookieVerified: true, aprText, streamEvidence, clipboard,
      liveGatewayQualified: false, liveFundsTested: false, realPhoneTested: false }
  } finally { await browser.close() }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { target, ...options } = checkArguments(process.argv.slice(2))
  console.log(JSON.stringify(await smokeBrowser(target, { ...options,
    storageState: process.env.SAFFRON_STAGING_STORAGE_STATE,
    requireApr: process.env.SAFFRON_REQUIRE_APR === '1', checkClipboard: process.env.SAFFRON_CHECK_CLIPBOARD === '1',
  }), null, 2))
}
