// Small production server for the Saffron dashboard.
//  - serves the built static app from ../dist
//  - proxies POST /rpc/<chain> to the matching QuickNode endpoint, keeping the secret token
//    server-side so it never ships to the browser
//  - only forwards a small allowlist of read-only JSON-RPC methods, so a public URL can't be used
//    to drain the QuickNode quota with arbitrary calls
import { createServer } from 'node:http'
import { readFile, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

import { createVaultRequestHandler } from './vault-requests.mjs'
import { createRequestDatabase } from './request-database.mjs'
import { createIncentiveProgramHandler } from './incentive-programs.mjs'
import { createOperatorAuth } from './operator-auth.mjs'
import { createLifecycleService } from './lifecycle-service.mjs'
import { createLifecycleHandler } from './lifecycle-api.mjs'

const readFileAsync = promisify(readFile)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIST = resolve(process.env.DIST_DIR || join(ROOT, 'dist'))
const PORT = Number(process.env.PORT) || 3201
const HOST = process.env.BIND_HOST || '127.0.0.1'
// Match the build mount; only an absolute path prefix is accepted.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '')
if (BASE_PATH && !/^\/[a-zA-Z0-9/_-]*$/.test(BASE_PATH)) throw new Error('Invalid BASE_PATH')

// RPC targets: process.env wins (for prod hosting), else the .env used by the frontend in dev.
const env = {}
try {
  for (const line of readFileSync(join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(\S+)/)
    if (m && !line.trim().startsWith('#')) env[m[1]] = m[2]
  }
} catch { /* no .env — rely on process.env */ }

const RPC = {
  // Public fallbacks keep Ethereum and Arbitrum useful before private
  // QuickNode endpoints are supplied. Production secrets still override them.
  ethereum:
    process.env.RPC_ETHEREUM ||
    env.VITE_RPC_ETHEREUM ||
    'https://ethereum-rpc.publicnode.com',
  arbitrum:
    process.env.RPC_ARBITRUM ||
    env.VITE_RPC_ARBITRUM ||
    'https://arbitrum-one-rpc.publicnode.com',
  robinhood: process.env.RPC_ROBINHOOD || env.VITE_RPC_ROBINHOOD,
}

// All request, oracle and admin-ownership reads use operator-owned RPCs.
// Neither database access nor fee quotes can broadcast a transaction.
async function requestRpc(chain, method, params) {
  const target = Object.hasOwn(RPC, chain) ? RPC[chain] : null
  if (!target) throw new Error('RPC unavailable')
  const response = await fetch(target, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(15000),
  })
  if (!response.ok) throw new Error('RPC unavailable')
  const payload = await response.json()
  if (payload.error || payload.result === undefined) throw new Error('RPC unavailable')
  return payload.result
}
const storePath = resolve(process.env.VAULT_REQUEST_STORE_PATH || join(ROOT, 'data', 'vault-requests.json'))
const schemaMode = process.env.SAFFRON_DB_SCHEMA_MODE || 'standalone'
// JSON-only mode is deliberately restricted to isolated legacy test fixtures.
const requestDatabase = process.env.NODE_ENV === 'test' && process.env.SAFFRON_REQUEST_STORAGE === 'json' ? null
  : createRequestDatabase({ legacyPath: storePath, schemaMode, resolvePoolFee: async (chain, address) =>
    Number(BigInt(await requestRpc(chain, 'eth_call', [{ to: address, data: '0xddca3f43' }, 'latest']))) })
// Authorization belongs to an explicit operator policy, not factory ownership.
const creatorSigner = process.env.SAFFRON_CREATOR_ADDRESS || null
const operatorAuth = createOperatorAuth({ operators: (process.env.SAFFRON_ADMIN_WALLETS || '').split(','),
  origin: process.env.SAFFRON_APP_ORIGIN, basePath: BASE_PATH })
const lifecycle = requestDatabase ? createLifecycleService({ database: requestDatabase,
  rpc: (method, params) => requestRpc('robinhood', method, params), signer: creatorSigner }) : null
const handleLifecycle = createLifecycleHandler({ database: requestDatabase, auth: operatorAuth,
  service: lifecycle, signer: creatorSigner, basePath: BASE_PATH })
const observerTimer = setInterval(() => { void lifecycle?.poll().catch(() => {}) }, 5000)
observerTimer.unref()
const handlePrograms = createIncentiveProgramHandler({ database: requestDatabase, adminAllowed: operatorAuth.permitted,
  basePath: BASE_PATH, rpc: (method, params) => requestRpc('robinhood', method, params) })
const handleVaultRequest = createVaultRequestHandler({
  recipient: process.env.VAULT_REQUEST_PAYMENT_ADDRESS, storePath, database: requestDatabase,
  basePath: BASE_PATH, rpc: (method, params) => requestRpc('arbitrum', method, params),
  adminAllowed: operatorAuth.permitted, lifecycle,
})

const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_getBalance',
  'eth_blockNumber',
  'eth_call',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getTransactionByHash',
  'eth_getTransactionReceipt',
  'eth_getCode',
  'net_version',
])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ttf': 'font/ttf',
  '.glb': 'model/gltf-binary',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.map': 'application/json',
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let b = ''
    req.on('data', (c) => {
      b += c
      if (b.length > 2_000_000) { reject(new Error('body too large')); b = ''; req.removeAllListeners('data'); req.resume() }
    })
    req.on('end', () => resolve(b))
    req.on('error', reject)
  })
}

// Every call in the (possibly batched) JSON-RPC payload must be in the allowlist.
function allMethodsAllowed(raw) {
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return false
  }
  const calls = Array.isArray(parsed) ? parsed : [parsed]
  return calls.length > 0 && calls.every((c) => c && c.jsonrpc === '2.0'
    && (typeof c.id === 'string' || typeof c.id === 'number' || c.id === null)
    && (c.params === undefined || Array.isArray(c.params)) && ALLOWED_METHODS.has(c.method))
}

const server = createServer(async (req, res) => {
  // Force one request per connection (no keep-alive). Some browsers reach this server through a
  // forward proxy (a VPN / corporate proxy — it sends `Proxy-Connection` and absolute-URI request
  // lines) that pipelined requests and desynced their HTTP framing, so one request's body bled into
  // the next and Node rejected it with HPE_INVALID_METHOD → 400. Closing after each response stops
  // the pipelining and the desync. (TLS in front would also fix it by tunnelling opaquely.)
  res.setHeader('Connection', 'close')

  let url
  try { url = new URL(req.url, 'http://localhost') }
  catch { return end(res, 400, 'invalid URL') }

  if (await handleLifecycle(req, res, url.pathname)) return
  if (await handleVaultRequest(req, res, url.pathname)) return
  if (await handlePrograms(req, res, url.pathname)) return
  if (url.pathname.startsWith(`${BASE_PATH}/vault-requests/`)) return end(res, 404, 'not found')

  // Catalog tokens and legacy aliases only; the upstream host/chain are always fixed.
  if (url.pathname.startsWith(`${BASE_PATH}/prices/`)) {
    if (!['GET', 'HEAD'].includes(req.method)) return end(res, 405, 'GET or HEAD only')
    const key = url.pathname.slice(`${BASE_PATH}/prices/`.length)
    const tokens = { ETH: '0x0bd7d308f8e1639fab988df18a8011f41eacad73', USDG: '0x5fc5360d0400a0fd4f2af552add042d716f1d168' }
    try {
      const token = Object.hasOwn(tokens, key) ? { address: tokens[key], symbol: key }
        : /^0x[0-9a-fA-F]{40}$/.test(key) ? await requestDatabase?.quoteToken(key) : null
      if (!token) return end(res, 404, 'unknown token')
      const response = await fetch(`https://api.saffron.finance/api/v1/tokens/4663/${token.address}/price?symbol=${encodeURIComponent(token.symbol)}`, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('Price unavailable')
      const payload = await response.json()
      endJson(res, 200, payload)
    } catch { endJson(res, 502, { success: false, error: 'Token price unavailable' }) }
    return
  }

  const rpcPrefix = `${BASE_PATH}/rpc/`
  if (url.pathname.startsWith(rpcPrefix)) {
    const chain = url.pathname.slice(rpcPrefix.length).replace(/\/$/, '')
    const target = Object.hasOwn(RPC, chain) ? RPC[chain] : null
    if (!target) return end(res, 404, 'unknown chain')
    if (req.method !== 'POST') return end(res, 405, 'POST only')
    let body
    try {
      body = await readBody(req)
    } catch {
      return end(res, 413, 'body too large')
    }
    if (!allMethodsAllowed(body)) return endJson(res, 403, { error: 'method not allowed' })
    try {
      const upstream = await fetch(target, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
        signal: AbortSignal.timeout(20_000),
      })
      const text = await upstream.text()
      res.writeHead(upstream.status, { 'content-type': 'application/json' })
      res.end(text)
    } catch {
      endJson(res, 502, { error: 'upstream failed' })
    }
    return
  }

  // static files (with SPA fallback to index.html)
  if (BASE_PATH && url.pathname !== BASE_PATH && !url.pathname.startsWith(`${BASE_PATH}/`)) {
    return end(res, 404, 'not found')
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return end(res, 405, 'GET or HEAD only')
  let p
  try { p = decodeURIComponent(url.pathname.slice(BASE_PATH.length)) }
  catch { return end(res, 400, 'invalid path') }
  if (p === '' || p === '/') p = '/index.html'
  const filePath = resolve(DIST, `.${p}`)
  const relativePath = relative(DIST, filePath)
  if (relativePath.startsWith('..') || relativePath === '') return end(res, 403, 'forbidden')
  try {
    const data = await readFileAsync(filePath)
    res.writeHead(200, { 'content-type': MIME[extname(filePath)] || 'application/octet-stream' })
    res.end(data)
  } catch {
    try {
      const data = await readFileAsync(join(DIST, 'index.html'))
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
      res.end(data)
    } catch {
      end(res, 404, 'not found')
    }
  }
})

function end(res, code, msg) {
  res.writeHead(code, { 'content-type': 'text/plain' })
  res.end(msg)
}
function endJson(res, code, obj) {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(obj))
}

// Enforce one request per TCP connection at the server level too — belt and suspenders with the
// per-response `Connection: close` above.
server.maxRequestsPerSocket = 1
server.requestTimeout = 30_000
server.headersTimeout = 15_000

// Answer a malformed request (e.g. one an upstream proxy mangled) cleanly instead of letting it
// disrupt the socket.
server.on('clientError', (_err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
})

server.listen(PORT, HOST, () => {
  const chains = Object.entries(RPC)
    .filter(([, v]) => v)
    .map(([k]) => k)
  console.log(`Saffron dashboard on http://${HOST}:${PORT}`)
  console.log(`Proxying: ${chains.join(', ') || '(none — set RPC_* env or .env VITE_RPC_*)'}`)
})
