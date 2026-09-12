import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createServer } from 'node:http'
import { writeReleaseMarker, verifyRelease } from '../scripts/release-artifact.mjs'
import { checkDeployment } from '../scripts/check_live.mjs'

test('served releases verify root/nested live variants and reject partial publication or false readiness', async () => {
  const prefix = join(tmpdir(), 'saffron-artifact-'), root = await mkdtemp(prefix)
  let marker, base = '/', corrupt, missing, htmlApi = false, recipient = true, closed = false, inheritedOperator = false
  const release = { package: 'saffron-live-apr-merge', version: '0.3.0', revision: 'a'.repeat(40), sourceDigest: 'b'.repeat(64), dirty: false }
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname.slice(base.length)
    const json = (value, status = 200) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(value)) }
    if (path === 'deployment-mode.json') return json(marker)
    if (path === 'api/incentives/programs') {
      if (htmlApi) { res.writeHead(200, { 'content-type': 'text/html' }); return res.end('<html>fallback</html>') }
      return json({ offers: [{}], readiness: { canQuote: !closed, intakeReady: !closed, checkedAt: Date.now(),
        checks: { configuration: true, recipient, rpc: true, campaignFee: true, sizing: true } } })
    }
    if (path === 'api/incentives/admin/status') return json({}, inheritedOperator ? 200 : 401)
    if (path === 'api/incentives/checkout/session') return json({}, 403)
    if (path === 'rpc/robinhood') {
      if (req.method !== 'POST') return json({}, 405)
      let body = ''; for await (const chunk of req) body += chunk
      const call = JSON.parse(body)
      if (Array.isArray(call) || !['eth_chainId', 'eth_getTransactionCount'].includes(call.method)) return json({}, 403)
      return json({ jsonrpc: '2.0', id: call.id, result: call.method === 'eth_chainId' ? '0x1237' : '0x0' })
    }
    if (/^(api|rpc|prices)\//.test(path) || path.includes('missing-')) return json({}, 404)
    try {
      const file = !path || ['portfolio/vaults', 'campaigns', 'live-apr'].includes(path) ? 'index.html' : path
      if (file === missing) return json({}, 404)
      const data = await readFile(join(root, file))
      res.writeHead(200, { 'content-type': file.endsWith('.html') ? 'text/html' : file.endsWith('.json') ? 'application/json' : 'text/javascript' })
      res.end(corrupt === file ? 'mixed release' : data)
    } catch { json({}, 404) }
  })
  try {
    await mkdir(join(root, 'assets')); await mkdir(join(root, '.vite'))
    await writeFile(join(root, 'assets/app.js'), 'export const app = true')
    await writeFile(join(root, 'assets/lazy.js'), 'export const lazy = true')
    await writeFile(join(root, '.vite/manifest.json'), JSON.stringify({ 'index.html': { isEntry: true, file: 'assets/app.js', dynamicImports: ['lazy.ts'] }, 'lazy.ts': { file: 'assets/lazy.js' } }))
    server.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve))
    const origin = 'http://127.0.0.1:' + server.address().port
    for (base of ['/', '/nested/app/']) {
      await writeFile(join(root, 'index.html'), '<!doctype html><script type="module" src="' + base + 'assets/app.js"></script>')
      for (const appearanceControls of [false, true]) {
        marker = writeReleaseMarker(root, { release, basePath: base, incentives: 'canonical-api', wallet: true, appearanceControls })
        assert.equal((await checkDeployment(origin + base, { expectedRelease: release })).paymentReady, true)
      }
      marker.wallet = false
      await assert.rejects(() => verifyRelease(origin + base), /Wallet\/adapter mismatch/)
      marker.wallet = true; marker.incentives = 'browser-simulation'
      await assert.rejects(() => verifyRelease(origin + base), /Wrong incentive adapter/)
      marker.wallet = false
      await assert.rejects(() => verifyRelease(origin + base, { expectedMode: 'browser-simulation' }), /Wrong incentive adapter/)
      marker.incentives = 'canonical-api'; marker.wallet = true
      for (corrupt of ['index.html', 'assets/lazy.js']) await assert.rejects(() => verifyRelease(origin + base), /Served asset differs/)
      corrupt = undefined
      missing = 'assets/lazy.js'
      await assert.rejects(() => verifyRelease(origin + base), /must return HTTP 200/)
      missing = undefined
      const rightBase = marker.basePath; marker.basePath = '/wrong/'
      await assert.rejects(() => verifyRelease(origin + base), /Wrong release mount/)
      marker.basePath = rightBase
      htmlApi = true
      await assert.rejects(() => checkDeployment(origin + base), /must not return SPA HTML/)
      htmlApi = false; recipient = false
      await assert.rejects(() => checkDeployment(origin + base), /prerequisite failed: recipient/)
      closed = true
      assert.equal((await checkDeployment(origin + base, { expectClosed: true })).paymentReady, false)
      closed = false; recipient = true; inheritedOperator = true
      await assert.rejects(() => checkDeployment(origin + base), /must not grant application operator/)
      inheritedOperator = false
      await assert.rejects(() => verifyRelease(origin + base, { expectedRelease: { ...release, revision: 'c'.repeat(40) } }), /approved source manifest/)
      marker.release = { ...release, dirty: true }
      await assert.rejects(() => verifyRelease(origin + base), /unchanged source/)
    }
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    if (!resolve(root).startsWith(resolve(prefix))) throw Error('Unexpected artifact test directory')
    await rm(root, { recursive: true, force: true })
  }
})
