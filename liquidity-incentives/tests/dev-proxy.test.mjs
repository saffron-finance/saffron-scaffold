import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createServer as httpServer } from 'node:http'
import { createServer as viteServer } from 'vite'

it('the actual Vite configuration forwards address prices to the application API', async () => {
  const seen = []
  const api = httpServer((req, res) => {
    seen.push(req.url)
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ success: true, data: { price: 2000 } }))
  })
  await new Promise(resolve => api.listen(0, '127.0.0.1', resolve))
  const previous = process.env.DEV_API_ORIGIN
  process.env.DEV_API_ORIGIN = `http://127.0.0.1:${api.address().port}`
  let vite
  try {
    vite = await viteServer({ server: { host: '127.0.0.1', port: 0 }, logLevel: 'error' })
    await vite.listen()
    const path = '/prices/0x0bd7d308f8e1639fab988df18a8011f41eacad73'
    const response = await fetch(`http://127.0.0.1:${vite.httpServer.address().port}${path}`)
    assert.match(response.headers.get('content-type'), /application\/json/)
    assert.equal((await response.json()).data.price, 2000)
    assert.deepEqual(seen, [path])
  } finally {
    if (previous === undefined) delete process.env.DEV_API_ORIGIN
    else process.env.DEV_API_ORIGIN = previous
    await vite?.close()
    await new Promise(resolve => api.close(resolve))
  }
})
