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
import { promisify,parseEnv } from 'node:util'

import { createIncentivesDatabase } from './incentives-database.mjs'
import { createWalletAuth } from './wallet-auth.mjs'
import { createIncentivesService } from './incentives-service.mjs'
import { createIncentivesHandler } from './incentives-api.mjs'
import { createPriceService } from './price-service.mjs'

const readFileAsync = promisify(readFile)
const ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..')
let env={}
try { env=parseEnv(readFileSync(join(ROOT,'.env'),'utf8')) }
catch(error) { if(error.code!=='ENOENT')throw new Error('Cannot read application environment configuration.') }
const configured = name => process.env[name] ?? env[name]
const DIST = resolve(configured('DIST_DIR') || join(ROOT, 'dist'))
const PORT = Number(configured('PORT')) || 3201
const HOST = configured('BIND_HOST') || '127.0.0.1'
// Match the build mount; only an absolute path prefix is accepted.
const BASE_PATH = (configured('BASE_PATH') || '').replace(/\/$/, '')
if (BASE_PATH && !/^\/[a-zA-Z0-9/_-]*$/.test(BASE_PATH)) throw new Error('Invalid BASE_PATH')

const RPC={robinhood:configured('RPC_ROBINHOOD')}

// Read-only protocol calls use application-owned RPC endpoints.
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
const database = configured('SAFFRON_API_DISABLED') === '1' ? null : createIncentivesDatabase({connection:{
  host:configured('PGHOST'),port:Number(configured('PGPORT')||5432),user:configured('PGUSER'),
  password:configured('PGPASSWORD'),database:configured('PGDATABASE'),connectionTimeoutMillis:5000,
}})
let protocol
try { if(configured('SAFFRON_PROTOCOL_CONFIG'))protocol=JSON.parse(readFileSync(configured('SAFFRON_PROTOCOL_CONFIG'),'utf8')) }
catch { throw new Error('Cannot read protocol configuration.') }
const signer=protocol?.signerAddress
const rpc=(method,params)=>requestRpc('robinhood',method,params)
const prices=createPriceService({database,root:configured('PRICE_API_ROOT')})
const auth=createWalletAuth({operators:(configured('SAFFRON_ADMIN_WALLETS')||'').split(','),origin:configured('SAFFRON_APP_ORIGIN'),basePath:BASE_PATH})
const service=database?createIncentivesService({database,rpc,usdQuote:prices.quote,config:protocol,signer,origin:auth.origin,feeRecipient:configured('SAFFRON_CREATION_FEE_RECIPIENT')}):null
const handleIncentives=createIncentivesHandler({database,auth,service,rpc,basePath:BASE_PATH})
const observerTimer=setInterval(()=>{void service?.poll().catch(()=>{})},5000)
observerTimer.unref()

const ALLOWED_METHODS = new Set([
  'eth_chainId',
  'eth_getBalance',
  'eth_blockNumber',
  'eth_call',
  'eth_estimateGas',
  'eth_getLogs',
  'eth_getBlockByNumber',
  'eth_getTransactionByHash',
  'eth_getTransactionCount',
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
  return calls.length > 0 && calls.length <= 50 && calls.every((c) => c && c.jsonrpc === '2.0'
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

  if (await handleIncentives(req,res,url.pathname)) return
  if (url.pathname.startsWith(BASE_PATH+'/api/')) return endJson(res,404,{error:'Endpoint not found.'})
  if (url.pathname.startsWith(BASE_PATH+'/prices/')) {
    if (!['GET','HEAD'].includes(req.method)) return end(res,405,'GET or HEAD only')
    const address=url.pathname.slice((BASE_PATH+'/prices/').length)
    if(!/^0x[0-9a-fA-F]{40}$/.test(address))return endJson(res,404,{error:'Unknown price token.'})
    try { endJson(res,200,await prices.payload(address)) }
    catch { endJson(res,502,{success:false,error:'Token price unavailable'}) }
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
      if(!upstream.ok)throw new Error('Upstream unavailable')
      const payload=await upstream.json()
      const safe=reply=>{
        if(!reply||reply.jsonrpc!=='2.0'||!['string','number'].includes(typeof reply.id)&&reply.id!==null)throw new Error('Malformed upstream response')
        // Provider diagnostics can contain endpoint credentials or internal paths.
        if(reply.error)return {jsonrpc:'2.0',id:reply.id,error:{code:-32000,message:'Read failed.'}}
        if(reply.result===undefined)throw new Error('Missing RPC result')
        return {jsonrpc:'2.0',id:reply.id,result:reply.result}
      }
      endJson(res,200,Array.isArray(payload)?payload.map(safe):safe(payload))
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
    // Only application routes receive the SPA document. Missing hashed assets
    // and downloads must remain real 404s behind an API-wide reverse proxy.
    if (extname(filePath)) return end(res, 404, 'not found')
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
  console.log(`Proxying: ${chains.join(', ') || '(none — configure RPC_ROBINHOOD)'}`)
})
