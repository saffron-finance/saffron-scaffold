import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { createServer as createHttpServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { chromium, expect } from '@playwright/test'

/** Native Chromium fetch and actual server socket lifecycle, not mocked fetch.
 * The only accelerated clock is the page's deadline timer; transport is real. */
test('native logo resource ownership', { timeout: 60000 }, async t => {
  const pending = new Map(), closed = [], sinkRequests = [], controls = []
  const sink = createHttpServer((req, res) => { sinkRequests.push(req.url); res.setHeader('access-control-allow-origin', '*'); res.end('fixture-ok') })
  await new Promise(resolve => sink.listen(0, '127.0.0.1', resolve))
  const sinkOrigin = `http://127.0.0.1:${sink.address().port}`
  const server = await createServer({ configFile: false, resolve: { alias: {
    '@packages/api-types/live-pool-apr.mjs': fileURLToPath(new URL('../vendor/live-apr-shared/live-pool-apr.mjs', import.meta.url)),
    '@packages/onchain-config/live-pool-apr/pools.json': fileURLToPath(new URL('../vendor/live-apr-shared/pools.json', import.meta.url)),
  } }, optimizeDeps: { entries: [], include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js'] }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'owned-test-transport', configureServer(vite) {
    vite.middlewares.use((req, res, next) => {
      if (req.url === '/redirect/sessions') {
        let body = ''; req.on('data', chunk => { body += chunk }); req.on('end', () => {
          controls.push(body); res.writeHead(307, { location: sinkOrigin + '/collect' }); res.end()
        }); return
      }
      if (req.url === '/fixture') { res.setHeader('content-type', 'text/html'); res.end('<!doctype html><div id="logo"></div>'); return }
      if (req.url.startsWith('/hold/')) {
        const key = req.url; pending.set(key, res)
        res.setHeader('content-type', 'application/octet-stream'); res.write(Buffer.from([0]))
        res.once('close', () => { pending.delete(key); closed.push(key) }); return
      }
      next()
    })
  } }] })
  await server.listen()
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`
  const browser = await chromium.launch({ args: ['--enable-unsafe-swiftshader'] })
  try {
    for (const [id, mode] of [['FE-BOOT-021', 'sibling'], ['FE-BOOT-022', 'deadline'], ['FE-BOOT-023', 'abort']]) {
      await t.test(`${id} ${mode} closes native HTTP bodies and allows a healthy retry`, async () => {
        const page = await browser.newPage(), errors = []
        page.on('pageerror', error => errors.push(error.message))
        try {
          await page.goto(origin + '/fixture'); await page.clock.install()
          await page.evaluate(async mode => {
            window.Scene = (await import('/vendor/fixed-income-ui/shared/components/emblem3d/EmblemScene.ts')).EmblemScene
            window.owner = new AbortController()
            window.outcome = 'pending'
            window.loading = window.Scene.create({ container: document.querySelector('#logo'), signal: window.owner.signal,
              modelUrl: '/hold/' + mode + '-model', matcapUrl: '/hold/' + mode + '-texture' })
              .then(scene => { scene.dispose(); window.outcome = 'unexpected-success' }, () => { window.outcome = 'failed' })
          }, mode)
          await expect.poll(() => pending.size).toBe(2)
          if (mode === 'abort') await page.evaluate(() => window.owner.abort())
          if (mode === 'deadline') await page.clock.fastForward(15000)
          if (mode === 'sibling') pending.get('/hold/sibling-texture').destroy()
          await expect.poll(() => page.evaluate(() => window.outcome)).toBe('failed')
          await expect.poll(() => pending.size).toBe(0)
          assert.equal(closed.filter(key => key.startsWith('/hold/' + mode)).length, 2)
          assert.equal(await page.locator('#logo canvas').count(), 0)
          // A clean follow-up must use the real GLB, ImageBitmap, renderer and
          // disposal path; otherwise a permanently disabled loader could pass.
          const recovered = await page.evaluate(async () => {
            const scene = await window.Scene.create({ container: document.querySelector('#logo'), modelUrl: '/gl/emblem.glb', matcapUrl: '/gl/emblem-matcap.jpg', noiseUrl: '/gl/blue-noise.png' })
            scene.setSize(64, 64); scene.renderFrame()
            const canvasCount = document.querySelectorAll('#logo canvas').length
            scene.dispose(); scene.dispose()
            return { canvasCount, remaining: document.querySelectorAll('#logo canvas').length }
          })
          assert.deepEqual(recovered, { canvasCount: 1, remaining: 0 })
          assert.deepEqual(errors, [])
        } finally { await page.close() }
      })
    }
    await t.test('SEC-URL-004 native redirected admission cannot forward its control body', async () => {
      const page = await browser.newPage()
      try {
        await page.goto(origin + '/fixture')
        // Prove the sink is reachable so a refused redirect is not confused with
        // an unavailable fixture server or a CORS/network setup error.
        assert.equal(await page.evaluate(url => fetch(url).then(r => r.text()), sinkOrigin + '/health'), 'fixture-ok')
        await page.evaluate(async () => {
          const {SummaryClient} = await import('/src/livePoolApr/summary-client.ts')
          window.client = new SummaryClient('cashcat-eth-1', {api:'/redirect',loadId:'native-admission-canary'})
          window.client.start()
        })
        await expect.poll(() => controls.length).toBe(1)
        await expect.poll(() => page.evaluate(() => window.client.state.health.transportFailedAt !== null)).toBe(true)
        await page.evaluate(() => window.client.stop(true))
        assert.ok(controls[0].includes('native-admission-canary'))
        assert.deepEqual(sinkRequests, ['/health'])
      } finally { await page.close() }
    })
  } finally { for (const response of pending.values()) response.destroy(); await browser.close(); await server.close(); await new Promise(resolve => sink.close(resolve)) }
})
