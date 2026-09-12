import assert from 'node:assert/strict'

/** Check an API-connected release without connecting a wallet, requesting a
 * quote, or broadcasting a transaction. Use a loopback origin behind TLS auth;
 * credentials are deliberately forbidden in the command URL. A closed intake
 * is valid for staging, but is never reported as a payment-ready deployment. */
const target = new URL(process.argv[2] || 'http://127.0.0.1:3201/')
assert(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
  'Use an HTTP(S) base URL without credentials, query strings, or fragments.')
if (!target.pathname.endsWith('/')) target.pathname += '/'
const expectClosed = process.argv[3] === '--expect-closed'
assert(process.argv.length <= 4 && (!process.argv[3] || expectClosed), 'Only --expect-closed is supported.')
const checks = []
async function request(path, options) {
  return fetch(new URL(path, target), { ...options, redirect: 'error', signal: AbortSignal.timeout(25000) })
}
async function json(path) {
  const response = await request(path)
  assert.equal(response.status, 200, path + ' must return HTTP 200')
  assert.match(response.headers.get('content-type') || '', /application\/json/, path + ' must not return SPA HTML')
  return response.json()
}
async function rpc(body) {
  return request('rpc/robinhood', {method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify(body)})
}
const call = method => ({jsonrpc:'2.0', id:1, method, params:[]})
const mode = await json('deployment-mode.json')
assert.equal(mode.incentives, 'canonical-api')
assert.equal(mode.wallet, true)
assert.equal(mode.basePath.replace(/\/$/, ''), target.pathname.replace(/\/$/, ''))
checks.push('Served bundle selects the real wallet and canonical API at the correct mount')
const programs = await json('api/incentives/programs')
assert(Array.isArray(programs.offers) && typeof programs.readiness?.canQuote === 'boolean')
assert.equal(programs.readiness.canQuote, !expectClosed)
if (!expectClosed) {
  assert(programs.readiness.intakeReady, 'Payment intake is closed')
  for(const check of ['configuration','recipient','rpc','feeQuote','sizing'])assert.equal(programs.readiness.checks?.[check],true,'Checkout prerequisite failed: '+check)
  assert(Number.isFinite(programs.readiness.checkedAt)&&Date.now()-programs.readiness.checkedAt<30_000,'Checkout readiness is stale')
  assert(programs.offers.some(offer => !offer.availability), 'No payable live offer is configured')
}
checks.push(expectClosed ? 'Staging intake is closed; no payment-ready claim' : 'Canonical catalog has an available offer and open intake')
const chain = await rpc(call('eth_chainId'))
assert.equal(chain.status, 200)
assert.equal(BigInt((await chain.json()).result), 4663n)
checks.push('Read-only relay reaches Robinhood Chain 4663')
for(const tag of ['latest','pending']){
  const nonce=await rpc({...call('eth_getTransactionCount'),params:['0x0000000000000000000000000000000000000001',tag]})
  assert.equal(nonce.status,200);assert.match((await nonce.json()).result,/^0x[0-9a-f]+$/i)
}
// Deliberately invalid bytes ensure the negative check cannot transfer funds
// even if an incorrectly configured relay were to forward the request.
assert.equal((await rpc({...call('eth_sendRawTransaction'), params:['0x']})).status, 403)
assert.equal((await rpc([call('eth_chainId'), call('personal_sign')])).status, 403)
assert.equal((await request('rpc/robinhood')).status, 405)
assert.equal((await request('rpc/not-a-chain', {method:'POST'})).status, 404)
assert.equal((await request('assets/missing-preflight.js')).status, 404)
assert.equal((await request('api/missing-preflight')).status, 404)
assert.equal((await request('portfolio/vaults')).status, 200)
checks.push('Broadcasts/mixed signing batches rejected; RPC methods, API routing and asset 404s preserved')
console.log(JSON.stringify({ok:true, paymentReady:!expectClosed, walletBroadcasts:0, checks}, null, 2))
