import assert from 'node:assert/strict'
import { createServer, request } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { after, before, it } from 'node:test'
import { setTimeout as delay } from 'node:timers/promises'

let processUnderTest, origin, upstream, output = ''
const base = '/incentives'

/** Start the real production server with a local, non-signing RPC fixture. */
before(async () => {
  upstream = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk
    const payload = JSON.parse(body)
    const reply = (call) => call.method==='eth_getCode'
      ? {jsonrpc:'2.0',id:call.id,error:{code:-32000,message:'Provider credential: fixture-secret',data:{path:'private/provider/path'}}}
      : { jsonrpc: '2.0', id: call.id, result: '0x1237' }
    if(payload.method==='eth_getBalance'){res.writeHead(503);res.end('Unavailable at private/provider/fixture-secret');return}
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify(Array.isArray(payload) ? payload.map(reply) : reply(payload)))
  })
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening')
  const rpc = `http://127.0.0.1:${upstream.address().port}`
  const reservation = createServer()
  reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening')
  const port = reservation.address().port
  await new Promise((resolve) => reservation.close(resolve))
  origin = `http://127.0.0.1:${port}`
  processUnderTest = spawn(process.execPath, ['server/proxy.mjs'], {
    env: { ...process.env, NODE_ENV: 'test', BASE_PATH: base, SAFFRON_API_DISABLED: '1', PORT: String(port), DIST_DIR: 'dist', RPC_ROBINHOOD: rpc },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  processUnderTest.stdout.on('data', (data) => { output += data })
  processUnderTest.stderr.on('data', (data) => { output += data })
  for (let attempt = 0; attempt < 100; attempt++) {
    try { if ((await fetch(`${origin}${base}/`)).ok) return } catch { /* Wait for this child only. */ }
    await delay(20)
  }
  throw new Error('Local production server did not start')
})
after(async () => {
  if (processUnderTest && processUnderTest.exitCode === null) { processUnderTest.kill(); await once(processUnderTest, 'exit') }
  if (upstream) await new Promise((resolve) => upstream.close(resolve))
})
const post = (body, chain = 'robinhood') => fetch(`${origin}${base}/rpc/${chain}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify(body),
})

it('serves the built asset and both route variants', async () => {
  const index = await (await fetch(`${origin}${base}/`)).text()
  const asset = index.match(/src="([^"]+\.js)"/)[1]
  assert.equal((await fetch(`${origin}${base}${asset}`)).status, 200)
  assert.equal((await fetch(`${origin}${base}/review/`)).status, 200)
  assert.equal((await fetch(`${origin}/outside-app`)).status, 404)
})
it('does not disguise missing assets or downloads as successful SPA responses', async () => {
  for (const path of ['/assets/missing-release.js', '/assets/missing-release.css', '/missing-source.zip', '/missing.json']) {
    const response = await fetch(origin + base + path)
    assert.equal(response.status, 404, path)
    assert.doesNotMatch(response.headers.get('content-type'), /text\/html/)
  }
  assert.equal((await fetch(origin + base + '/portfolio/vaults')).status, 200)
})
it('relays canonical reads but rejects every disallowed member of a batch', async () => {
  const read = { jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }
  assert.equal((await (await post(read)).json()).result, '0x1237')
  for(const tag of ['latest','pending'])assert.equal((await (await post({...read,method:'eth_getTransactionCount',params:['0x'+'1'.repeat(40),tag]})).json()).result,'0x1237')
  assert.equal((await post(Array(51).fill(read))).status,403)
  assert.equal((await post([read, { ...read, method: 'eth_sendRawTransaction' }])).status, 403)
  for (const method of ['eth_accounts', 'personal_sign', 'eth_sendTransaction', 'debug_traceTransaction', 'wallet_switchEthereumChain']) {
    assert.equal((await post({ ...read, method })).status, 403)
  }
})
it('rejects malformed payloads, wrong methods, unknown or prototype-chain names', async () => {
  for (const body of ['{', '[]', '{}', 'null', JSON.stringify({ method: 'eth_chainId' })]) assert.equal((await post(body)).status, 403)
  assert.equal((await fetch(`${origin}${base}/rpc/robinhood`)).status, 405)
  for (const chain of ['unknown', 'constructor', '__proto__']) assert.equal((await post('{}', chain)).status, 404)
})
it('bounds RPC bodies and malformed paths without crashing the server', async () => {
  assert.equal((await post('x'.repeat(2_000_001))).status, 413)
  assert.equal((await fetch(`${origin}${base}/%zz`)).status, 400)
  const response = await new Promise((resolve, reject) => {
    const req = request(`${origin}${base}/`, { path: `${base}/%2e%2e%2f%2e%2e%2fpackage.json` }, (res) => { res.resume(); resolve(res.statusCode) })
    req.on('error', reject); req.end()
  })
  assert.equal(response, 403)
  assert.equal((await fetch(`${origin}${base}/`)).status, 200)
})
it('fails closed when the API database is explicitly disabled', async () => {
  assert.equal((await fetch(origin+base+'/api/incentives/programs')).status,503)
  assert.doesNotMatch(output, /EACCES|stack|RPC_ETHEREUM=|RPC_ARBITRUM=/)
})
it('sanitizes provider diagnostics and fails closed during an RPC outage',async()=>{
  const read={jsonrpc:'2.0',id:1,method:'eth_getCode',params:[]}
  const error=await (await post([read])).json()
  assert.deepEqual(error,[{jsonrpc:'2.0',id:1,error:{code:-32000,message:'Read failed.'}}])
  const unavailable=await post({...read,method:'eth_getBalance'})
  assert.equal(unavailable.status,502)
  assert.doesNotMatch(await unavailable.text(),/fixture-secret|private\/provider/)
  assert.doesNotMatch(output,/fixture-secret|private\/provider/)
})
