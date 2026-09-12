import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { verifyRelease, mountPath } from './release-artifact.mjs'

export function checkArguments(args) {
  const [url, ...flags] = args
  assert(url, 'Supply the actual HTTP(S) application mount')
  const target = new URL(url)
  assert(['http:', 'https:'].includes(target.protocol) && !target.username && !target.password && !target.search && !target.hash,
    'Use an HTTP(S) base URL without credentials, query strings, or fragments')
  target.pathname = mountPath(target.pathname)
  let expectClosed = false, expectedRelease
  for (let i = 0; i < flags.length; i++) {
    if (flags[i] === '--expect-closed') expectClosed = true
    else if (flags[i] === '--source-manifest') {
      assert(flags[i + 1], 'Supply the extracted source-manifest.json path')
      expectedRelease = JSON.parse(readFileSync(flags[++i], 'utf8')).release
      assert(expectedRelease, 'Missing release identity in source manifest')
    } else throw Error('Unknown release-check option')
  }
  return { target, expectClosed, expectedRelease }
}

/** No quote, wallet, worker command or valid transaction is submitted. Existing
 * hosting-auth sessions can supply request(); authentication is never logged. */
export async function checkDeployment(target, { expectClosed = false, expectedRelease, requireClean = true,
  request = (path, options) => fetch(new URL(path, target), { ...options, redirect: 'error',
    signal: AbortSignal.timeout(25000), cache: 'no-store' }),
} = {}) {
  target = new URL(target)
  const checks = []
  const json = async path => {
    const response = await request(path)
    assert.equal(response.status, 200, path + ' must return HTTP 200')
    assert.match(response.headers.get('content-type') || '', /application\/json/, path + ' must not return SPA HTML')
    return response.json()
  }
  const mode = await verifyRelease(target, { request, expectedRelease, requireClean })
  checks.push('Merged live interface, source identity, entry and all required asset hashes agree at the correct mount')
  const programs = await json('api/incentives/programs')
  assert(Array.isArray(programs.offers) && typeof programs.readiness?.canQuote === 'boolean')
  assert.equal(programs.readiness.canQuote, !expectClosed, 'Checkout readiness differs from the expected intake state')
  if (!expectClosed) {
    assert(programs.readiness.intakeReady, 'Payment intake is closed')
    for (const check of ['configuration', 'recipient', 'rpc', 'feeQuote', 'sizing'])
      assert.equal(programs.readiness.checks?.[check], true, 'Checkout prerequisite failed: ' + check)
    const age = Date.now() - programs.readiness.checkedAt
    assert(Number.isFinite(age) && age >= -5000 && age < 30000, 'Checkout readiness is stale')
    assert(programs.offers.some(offer => !offer.availability), 'No payable live offer is configured')
  }
  checks.push(expectClosed ? 'Staging refuses new quotes; payment readiness is not claimed' : 'Canonical catalog has an available offer and open intake')
  const call = method => ({ jsonrpc: '2.0', id: 1, method, params: [] })
  const rpc = body => request('rpc/robinhood', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const chain = await rpc(call('eth_chainId'))
  assert.equal(chain.status, 200)
  assert.equal(BigInt((await chain.json()).result), 4663n)
  for (const tag of ['latest', 'pending']) {
    const nonce = await rpc({ ...call('eth_getTransactionCount'), params: ['0x0000000000000000000000000000000000000001', tag] })
    assert.equal(nonce.status, 200); assert.match((await nonce.json()).result, /^0x[0-9a-f]+$/i)
  }
  checks.push('Read-only relay reaches Robinhood 4663 and provides both nonce views')
  // Invalid bytes cannot transfer funds even if a misconfigured relay forwards them.
  assert.equal((await rpc({ ...call('eth_sendRawTransaction'), params: ['0x'] })).status, 403)
  assert.equal((await rpc([call('eth_chainId'), call('personal_sign')])).status, 403)
  assert.equal((await request('rpc/robinhood')).status, 405)
  assert.equal((await request('rpc/not-a-chain', { method: 'POST' })).status, 404)
  for (const path of ['assets/missing-preflight.js', 'api/missing-preflight', 'prices/not-a-token'])
    assert.equal((await request(path)).status, 404, 'Missing route must return 404: ' + path)
  for (const path of ['portfolio/vaults', 'campaigns', 'live-apr']) {
    const response = await request(path)
    assert.equal(response.status, 200); assert.match(response.headers.get('content-type') ?? '', /text\/html/)
  }
  const denied = await request('api/incentives/admin/status')
  assert([401, 403].includes(denied.status), 'Hosting access must not grant application operator authorization')
  assert.match(denied.headers.get('content-type') ?? '', /application\/json/)
  for (const headers of [{}, { origin: 'https://wrong-origin.invalid' }]) {
    const response = await request('api/incentives/checkout/session', { method: 'POST',
      headers: { 'content-type': 'application/json', ...headers }, body: '{}' })
    assert.equal(response.status, 403, 'Checkout must reject absent or foreign Origin')
  }
  checks.push('Signing methods, unauthorized operators and foreign checkout origins are rejected; SPA, pricing and asset boundaries are preserved')
  return { ok: true, paymentReady: !expectClosed, release: mode.release, assetDigest: mode.assetDigest,
    assetsVerified: Object.keys(mode.files).length, appearanceControls: mode.appearanceControls,
    readiness: programs.readiness, walletBroadcasts: 0, checks }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { target, ...options } = checkArguments(process.argv.slice(2))
  console.log(JSON.stringify(await checkDeployment(target, options), null, 2))
}
