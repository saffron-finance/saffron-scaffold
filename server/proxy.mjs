// Zero-dependency production server for the Saffron dashboard.
//  - serves the built static app from ../dist
//  - proxies POST /rpc/<chain> to the matching QuickNode endpoint, keeping the secret token
//    server-side so it never ships to the browser
//  - only forwards a small allowlist of read-only JSON-RPC methods, so a public URL can't be used
//    to drain the QuickNode quota with arbitrary calls
import { createServer } from 'node:http'
import { mkdir, readFile, readFileSync, rename, writeFile } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const readFileAsync = promisify(readFile)
const writeFileAsync = promisify(writeFile)
const mkdirAsync = promisify(mkdir)
const renameAsync = promisify(rename)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
const DIST = join(ROOT, 'dist')
const PORT = Number(process.env.PORT) || 3200
const HOST = process.env.BIND_HOST || '127.0.0.1'
// Mount at the domain root by default. A deployment can supply another prefix
// without changing or rebuilding the frontend source.
const BASE_PATH = (process.env.BASE_PATH || '').replace(/\/$/, '')
const REQUEST_STORE = resolve(process.env.VAULT_REQUEST_STORE_PATH || join(ROOT, 'data', 'vault-requests.json'))
const REQUEST_RECIPIENT = /^0x[0-9a-fA-F]{40}$/.test(process.env.VAULT_REQUEST_PAYMENT_ADDRESS || '')
  ? process.env.VAULT_REQUEST_PAYMENT_ADDRESS.toLowerCase()
  : null
const REQUEST_PAYMENT = {
  chainId: 42161,
  chainLabel: 'Arbitrum',
  token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  tokenSymbol: 'USDC',
  tokenDecimals: 6,
  amount: '2',
  rawAmount: 2_000_000n,
}

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

// The browser cannot call api.saffron.finance cross-origin. This deliberately
// narrow same-origin bridge exposes only the public, read-only fixed-vault list
// query used by the selector; callers cannot choose an arbitrary upstream URL
// or broaden the API filters.
const FIXED_VAULT_CHAIN_IDS = {
  ethereum: 1,
  arbitrum: 42161,
  robinhood: 4663,
}
const SAFFRON_API_ORIGIN = 'https://api.saffron.finance'

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

async function rpc(chain, method, params) {
  const target = RPC[chain]
  if (!target) throw new Error('RPC unavailable')
  const response = await fetch(target, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  if (!response.ok) throw new Error('RPC unavailable')
  const payload = await response.json()
  if (payload.error) throw new Error('RPC rejected request')
  return payload.result
}

function validRequest(value) {
  return value && /^0x[0-9a-fA-F]{40}$/.test(value.wallet) && /^0x[0-9a-fA-F]{64}$/.test(value.paymentTxHash)
    && ['ethereum', 'arbitrum', 'robinhood'].includes(value.chain)
    && typeof value.depositToken === 'string' && value.depositToken.trim().length > 0 && value.depositToken.length <= 80
    && typeof value.pair === 'string' && value.pair.trim().length > 0 && value.pair.length <= 80
    && typeof value.depositAmount === 'string' && /^\d+(\.\d+)?$/.test(value.depositAmount) && value.depositAmount.length <= 50
}

async function verifyPayment(body) {
  const [tx, receipt] = await Promise.all([
    rpc('arbitrum', 'eth_getTransactionByHash', [body.paymentTxHash]),
    rpc('arbitrum', 'eth_getTransactionReceipt', [body.paymentTxHash]),
  ])
  if (!tx || !receipt || receipt.status !== '0x1') throw new Error('Payment is not confirmed')
  if (tx.from?.toLowerCase() !== body.wallet.toLowerCase()) throw new Error('Payment wallet does not match')
  if (tx.to?.toLowerCase() !== REQUEST_PAYMENT.token.toLowerCase()) throw new Error('Wrong payment token')
  const input = String(tx.input || '').toLowerCase()
  if (!input.startsWith('0xa9059cbb') || input.length < 138) throw new Error('Invalid USDC transfer')
  const recipient = `0x${input.slice(34, 74)}`
  const amount = BigInt(`0x${input.slice(74, 138)}`)
  if (recipient !== REQUEST_RECIPIENT || amount !== REQUEST_PAYMENT.rawAmount) throw new Error('Payment must be exactly $2 USDC')
  return receipt
}

let requestWrite = Promise.resolve()
function appendVaultRequest(record) {
  requestWrite = requestWrite.catch(() => {}).then(async () => {
    await mkdirAsync(resolve(REQUEST_STORE, '..'), { recursive: true })
    let records = []
    try { records = JSON.parse(await readFileAsync(REQUEST_STORE, 'utf8')) } catch { /* first request */ }
    if (!Array.isArray(records)) throw new Error('Invalid request store')
    if (records.some((item) => item.paymentTxHash?.toLowerCase() === record.paymentTxHash.toLowerCase())) {
      throw new Error('This payment was already used')
    }
    records.push(record)
    const temp = `${REQUEST_STORE}.${process.pid}.tmp`
    await writeFileAsync(temp, `${JSON.stringify(records, null, 2)}\n`, { mode: 0o600 })
    await renameAsync(temp, REQUEST_STORE)
  })
  return requestWrite
}

const server = createServer(async (req, res) => {
  // Force one request per connection (no keep-alive). Some browsers reach this server through a
  // forward proxy (a VPN / corporate proxy — it sends `Proxy-Connection` and absolute-URI request
  // lines) that pipelined requests and desynced their HTTP framing, so one request's body bled into
  // the next and Node rejected it with HPE_INVALID_METHOD → 400. Closing after each response stops
  // the pipelining and the desync. (TLS in front would also fix it by tunnelling opaquely.)
  res.setHeader('Connection', 'close')

  const url = new URL(req.url, `http://${req.headers.host}`)

  const requestsPath = `${BASE_PATH}/vault-requests`
  if (url.pathname === `${requestsPath}/config`) {
    if (req.method !== 'GET') return end(res, 405, 'GET only')
    return endJson(res, 200, { ...REQUEST_PAYMENT, rawAmount: undefined, enabled: Boolean(REQUEST_RECIPIENT), recipient: REQUEST_RECIPIENT })
  }
  if (url.pathname === requestsPath) {
    if (req.method !== 'POST') return end(res, 405, 'POST only')
    if (!REQUEST_RECIPIENT) return endJson(res, 503, { error: 'Vault request payments are not configured' })
    let body
    try { body = JSON.parse(await readBody(req)) } catch { return endJson(res, 400, { error: 'Invalid request' }) }
    if (!validRequest(body)) return endJson(res, 400, { error: 'Invalid request' })
    try {
      const receipt = await verifyPayment(body)
      const record = {
        id: `VR-${body.paymentTxHash.slice(2, 10).toUpperCase()}`,
        status: 'paid_waiting_for_vault',
        createdAt: new Date().toISOString(),
        wallet: body.wallet.toLowerCase(), chain: body.chain,
        depositToken: body.depositToken.trim(), pair: body.pair.trim(), depositAmount: body.depositAmount,
        paymentChainId: REQUEST_PAYMENT.chainId, paymentTxHash: body.paymentTxHash.toLowerCase(),
        paymentBlock: receipt.blockNumber,
      }
      await appendVaultRequest(record)
      return endJson(res, 201, { id: record.id, status: record.status })
    } catch (error) {
      const message = String(error?.message || '')
      return endJson(res, /already used/.test(message) ? 409 : 402, { error: message || 'Payment verification failed' })
    }
  }

  const fixedVaultPrefix = `${BASE_PATH}/fixed-vaults/`
  if (url.pathname.startsWith(fixedVaultPrefix)) {
    if (req.method !== 'GET') return end(res, 405, 'GET only')
    const chain = url.pathname.slice(fixedVaultPrefix.length).replace(/\/$/, '')
    const chainId = FIXED_VAULT_CHAIN_IDS[chain]
    if (!chainId) return end(res, 404, 'unknown chain')
    try {
      const data = []
      let cursor
      // The upstream list uses forward-only keyset pagination. Walk every page
      // so "all networks" really includes one row for every available vault.
      for (let page = 0; page < 20; page++) {
        const upstreamUrl = new URL(`/api/v1/vaults/${chainId}/list`, SAFFRON_API_ORIGIN)
        const query = new URLSearchParams({
          status: 'Not Started',
          // Fetch both states; the UI defaults to the reference page's
          // showOor=0 behavior but can reveal out-of-range rows when toggled.
          includeOutOfRange: 'true',
          includeStale: 'true',
          includeNegativePnl: 'true',
          includeUnfilledVariable: 'true',
          includeFilledVariable: 'true',
          sort: 'fixedAprDesc',
          pageSize: '50',
        })
        if (cursor) query.set('cursor', cursor)
        upstreamUrl.search = query.toString()

        const upstream = await fetch(upstreamUrl, { headers: { accept: 'application/json' } })
        if (!upstream.ok) throw new Error(`upstream HTTP ${upstream.status}`)
        const payload = await upstream.json()
        if (Array.isArray(payload?.data)) data.push(...payload.data)
        cursor = payload?.meta?.nextCursor || undefined
        if (!cursor) break
      }
      res.writeHead(200, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'private, max-age=20',
      })
      res.end(JSON.stringify({ success: true, data, meta: { total: data.length } }))
    } catch {
      endJson(res, 502, { success: false, error: 'Saffron vault API unavailable' })
    }
    return
  }

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
