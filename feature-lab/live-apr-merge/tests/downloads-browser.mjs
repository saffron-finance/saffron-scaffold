import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve, extname, sep } from 'node:path'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { fixtureTransport } from './fixture-transport.mjs'

/** Fault-inject real compiled downloads. This localhost-only static fixture
 * has no database, signer, RPC forwarding or production configuration access.
 * The optional test build replaces only the WalletConnect peer, not its UI. */
const dist = resolve(process.env.MERGE_WEBROOT || 'validation/downloads-build')
const output = resolve(process.env.MERGE_EVIDENCE || 'validation/downloads')
const manifest = JSON.parse(await readFile(resolve(dist, '.vite/manifest.json')))
const html = await readFile(resolve(dist, 'index.html'), 'utf8')
const base = html.match(/src="([^"]*)assets\//)[1]
const wire = JSON.parse(await readFile(new URL('./fixtures/apr-wire.json', import.meta.url)))
const chunk = pattern => {
  const match = Object.entries(manifest).find(([key, value]) => pattern.test(key) || pattern.test(value.file))
  assert(match, `Missing download family ${pattern}`)
  return match[1].file
}
const logo = chunk(/Emblem3D\.tsx$/), apr = manifest['src/merge/AprSection.tsx']
const sdk = chunk(/walletconnect-sdk/), core = chunk(/assets\/core-/)
const types = { '.js': 'text/javascript', '.css': 'text/css', '.html': 'text/html', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary' }
const server = createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname)
    if (!pathname.startsWith(base)) { res.writeHead(404).end(); return }
    const local = pathname.slice(base.length), file = resolve(dist, local || 'index.html')
    if (!file.startsWith(dist + sep)) { res.writeHead(403).end(); return }
    if (/\/(api|rpc)\//.test(pathname)) { res.writeHead(503, { 'content-type': 'application/json' }).end('{"error":"Offline test fixture"}'); return }
    const selected = extname(local) ? file : resolve(dist, 'index.html')
    const body = await readFile(selected)
    res.writeHead(200, { 'content-type': types[extname(selected)] || 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
  } catch { res.writeHead(404).end() }
})
await new Promise(done => server.listen(0, '127.0.0.1', done))
const origin = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-swiftshader'] })
const cases = [
  { name: 'healthy desktop', healthy: true }, { name: 'healthy mobile', healthy: true, width: 390 },
  { name: 'logo JavaScript 404', files: [logo], still: true },
  { name: 'mobile logo JavaScript 404', files: [logo], still: true, width: 390 },
  { name: 'logo JavaScript corrupt response', files: [logo], still: true, corrupt: true },
  { name: 'logo model', files: ['gl/emblem.glb'], still: true },
  { name: 'logo matcap', files: ['gl/emblem-matcap.jpg'], still: true },
  { name: 'logo noise texture', files: ['gl/blue-noise.png'], still: true },
  { name: 'logo JavaScript and still image', files: [logo, 'gl/emblem-still.png'], textStill: true },
  { name: 'appearance editor', files: [chunk(/RowTweaks\.tsx$/)] },
  { name: 'simultaneous optional chunks', files: [logo, chunk(/RowTweaks\.tsx$/)], still: true },
  { name: 'APR JavaScript', files: [apr.file], section: true, route: 'live-apr' },
  { name: 'APR stylesheet', files: apr.css, section: true, route: 'live-apr' },
  { name: 'PNG capture JavaScript', files: [chunk(/html-to-image/)], png: true, route: 'live-apr' },
  { name: 'wallet connector JavaScript', files: [sdk], wallet: true },
  { name: 'wallet QR core JavaScript', files: [core], wallet: true },
  { name: 'wallet QR basic UI', files: [chunk(/scaffold-ui.*basic\.js$/)], wallet: true },
  { name: 'wallet QR modal UI', files: [chunk(/scaffold-ui.*w3m-modal\.js$/)], wallet: true },
  { name: 'images and fonts', assets: true, textStill: true },
  { name: 'entry stylesheet', files: manifest['index.html'].css },
  { name: 'entry JavaScript', files: [manifest['index.html'].file], boot: true },
  { name: 'unexpected shell effect', root: true },
]
const report = { ok: false, cases: [], externalRequests: [] }
try {
  await mkdir(output, { recursive: true })
  for (const scenario of cases.filter(item => !process.env.DOWNLOAD_CASE || item.name.includes(process.env.DOWNLOAD_CASE))) {
    const context = await browser.newContext({ viewport: { width: scenario.width || 1440, height: 950 },
      permissions: ['clipboard-read', 'clipboard-write'] })
    const failed = [], errors = [], writes = []
    // All API/relay/telemetry traffic is local-failed or blocked. The only
    // request bodies used here are synthetic APR fixture messages in memory.
    await context.route('**/*', async route => {
      const request = route.request(), url = new URL(request.url())
      if (url.origin !== origin) { report.externalRequests.push(url.origin); await route.abort(); return }
      if (!['GET', 'HEAD'].includes(request.method())) writes.push(url.pathname)
      const local = url.pathname.slice(base.length)
      if (scenario.files?.includes(local) || (scenario.assets && /\.(png|jpe?g|svg|woff2?|glb)$/.test(local))) {
        failed.push(local)
        await route.fulfill({ status: scenario.corrupt ? 200 : 404, contentType: 'text/javascript',
          body: scenario.corrupt ? 'not valid JavaScript !!!' : 'Injected download failure' })
      } else await route.continue()
    })
    await context.addInitScript(fixtureTransport, wire)
    await context.addInitScript(({ root }) => {
      localStorage.setItem('download-recovery-sentinel', 'keep')
      if (root) Object.defineProperty(document, 'title', { set() { throw new Error('Injected shell effect failure') } })
    }, scenario)
    const page = await context.newPage()
    page.setDefaultTimeout(12000)
    page.on('pageerror', error => errors.push(error.message))
    try {
      await page.goto(origin + base + (scenario.route || ''))
      if (scenario.boot) {
        await expect(page.locator('[data-boot-recovery]')).toBeVisible()
        await expect(page.getByRole('link', { name: 'Reload page' })).toBeVisible()
      } else if (scenario.root) {
        await expect(page.locator('[data-root-recovery]')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Reload page' })).toBeEnabled()
      } else {
        await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeVisible()
        const emblem = page.locator(scenario.width ? '[data-mobile-header-logo] [data-emblem-state]' : '[data-saffron-sidebar] [data-emblem-state]').first()
        if (scenario.healthy) await expect(emblem).toHaveAttribute('data-emblem-state', 'ready')
        if (scenario.still || scenario.textStill) {
          await expect(emblem).toHaveAttribute('data-emblem-state', 'static')
          if (scenario.still) {
            const image = emblem.locator('img')
            await expect(image).toBeVisible()
            assert(await image.evaluate(img => img.complete && img.naturalWidth > 0))
            await expect(image.locator('..')).toHaveCSS('opacity', '1')
          } else await expect(emblem).toHaveText('S')
        }
        if (scenario.section) {
          await expect(page.getByRole('heading', { name: 'This section could not load' })).toBeVisible()
          await page.getByRole('link', { name: 'Return to Home', exact: true }).click()
          await expect(page.getByRole('heading', { name: 'This section could not load' })).toHaveCount(0)
        }
        if (scenario.png) {
          await page.getByRole('button', { name: /^Copy .+ as PNG$/ }).first().click()
          await expect(page.getByRole('status').filter({ hasText: 'Could not copy PNG' })).toBeVisible()
          await expect(page.getByRole('button', { name: /^Copy .+ as PNG$/ }).first()).toBeEnabled()
        }
        await page.getByRole('button', { name: 'Connect wallet', exact: true }).click()
        if (scenario.wallet) {
          await page.getByRole('button', { name: 'WalletConnect', exact: true }).click()
          await expect(page.getByRole('dialog').getByRole('alert')).toBeVisible()
          await expect(page.getByRole('button', { name: 'Refresh wallets', exact: true })).toBeEnabled()
        }
        await expect(page.getByRole('dialog', { name: 'Connect wallet' })).toBeVisible()
        // A disabled provider row can lose keyboard focus while connecting;
        // exercise the always-available close control after a failed download.
        if (scenario.wallet) await page.getByRole('button', { name: 'Close dialog', exact: true }).click()
        else await page.keyboard.press('Escape')
        await expect(page.getByRole('dialog')).toHaveCount(0)
        await page.getByRole('button', { name: 'Select network', exact: true }).click()
        await expect(page.getByRole('dialog', { name: 'Select network' })).toBeVisible()
        await page.keyboard.press('Escape')
        await expect(page.locator('[data-root-recovery], [data-boot-recovery]')).toHaveCount(0)
      }
      for (const file of scenario.files || []) assert(failed.includes(file), `Unexercised download: ${file}`)
      if (scenario.assets) assert(failed.some(file => /woff/.test(file)), 'Fonts were actually requested')
      assert.equal(await page.evaluate(() => localStorage.getItem('download-recovery-sentinel')), 'keep')
      assert.deepEqual(writes, [], 'No wallet/API mutations sent')
      // A corrupt module can report a SyntaxError directly to window in addition
      // to rejecting import(); assert containment instead of hiding that signal.
      if (!scenario.corrupt) assert.deepEqual(errors, [], 'Unhandled browser errors')
      if (scenario.width && scenario.still) await page.screenshot({ path: resolve(output, 'mobile-static-fallback.png') })
      report.cases.push({ name: scenario.name, failed, errors, writes: 0 })
      console.log('PASS ' + scenario.name)
    } catch (error) {
      await page.screenshot({ path: resolve(output, 'failure.png') })
      console.error(JSON.stringify({ scenario: scenario.name, failed, errors }))
      throw error
    } finally { await context.close() }
  }
  report.ok = true
} finally {
  await writeFile(resolve(output, 'report.json'), JSON.stringify(report, null, 2) + '\n')
  await browser.close()
  await new Promise(done => server.close(done))
}
