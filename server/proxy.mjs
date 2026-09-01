// Zero-dependency production server for the Saffron dashboard.
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

const readFileAsync = promisify(readFile)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.PORT) || 3200
const HOST = process.env.BIND_HOST || '127.0.0.1'
// Mount at the domain root by default. A deployment can supply another prefix
// without changing or rebuilding the frontend source.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '')

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

const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_blockNumber',
  'eth_call',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getCode',
  'net_version',
])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
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
      if (b.length > 2_000_000) reject(new Error('body too large'))
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
  return calls.length > 0 && calls.every((c) => c && ALLOWED_METHODS.has(c.method))
}

const server = createServer(async (req, res) => {
  // Force one request per connection (no keep-alive). Some browsers reach this server through a
  // forward proxy (a VPN / corporate proxy — it sends `Proxy-Connection` and absolute-URI request
  // lines) that pipelined requests and desynced their HTTP framing, so one request's body bled into
  // the next and Node rejected it with HPE_INVALID_METHOD → 400. Closing after each response stops
  // the pipelining and the desync. (TLS in front would also fix it by tunnelling opaquely.)
  res.setHeader('Connection', 'close')

  const url = new URL(req.url, `http://${req.headers.host}`)

  const rpcPrefix = `${BASE_PATH}/rpc/`
  if (url.pathname.startsWith(rpcPrefix)) {
    const chain = url.pathname.slice(rpcPrefix.length).replace(/\/$/, '')
    const target = RPC[chain]
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
  let p = decodeURIComponent(url.pathname.slice(BASE_PATH.length))
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
