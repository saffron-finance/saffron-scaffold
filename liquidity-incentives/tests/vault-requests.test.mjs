import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { REQUEST_PAYMENT, requestMessage, validDetails, canonicalIncentive } from '../shared/vault-request.mjs'
import { createRequestStore, createVaultRequestHandler, verifyPayment } from '../server/vault-requests.mjs'
import { HASH, RECIPIENT, paymentFixture } from './payment-fixture.mjs'

// Fresh, unfunded, in-memory signing identities prove ownership validation
// without storing or printing any key or using a real user's wallet.
const account = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())
const body = { wallet: account.address, recipient: RECIPIENT, paymentTxHash: HASH,
  chain: 'robinhood', depositToken: 'USDC', pair: 'WETH / USDC', depositAmount: '1000' }
const directory = await mkdtemp(join(tmpdir(), 'liqifi-requests-test-'))

// An independently specified complete incentive form. Its USD principal and
// Robinhood target are intentionally different from the Arbitrum USDC fee.
const incentiveBody = { ...body, kind: 'incentive', depositToken: 'USD', pair: 'CASHCAT / ETH',
  incentive: { id: 'cashcat-eth-1000-3d', chainId: 4663,
    poolAddress: '0xA70fc67C9F69da90B63a0e4C05D229954574E313',
    token0: { address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4', symbol: 'CASHCAT', decimals: 18 },
    token1: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'ETH', decimals: 18 },
    durationDays: 3, capacityUsd: 100000, aprPercent: 1000, depositUsd: '1000', slippageBps: 50, range: 'full',
    quote: { cashcatAmount: 250000, quoteAmount: 0.25, rewardUsd: 1000 * 10 * 3 / 365,
      rewardCashcat: 1000 * 10 * 3 / 365 / 0.002, cashcatUsd: 0.002, quoteTokenUsd: 2000,
      quotePerCashcat: 0.000001, quotedAt: '2026-09-06T10:00:00.000Z' } } }

describe('complete incentive request contract', () => {
  let server, url, signature
  const path = join(directory, 'incentives.json')
  before(async () => {
    signature = await account.signMessage({ message: requestMessage(incentiveBody) })
    const handler = createVaultRequestHandler({ recipient: RECIPIENT, storePath: path, basePath: '/app', rpc: paymentFixture(account.address).rpc })
    server = createServer(async (req, res) => {
      if (!await handler(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end() }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${server.address().port}/app/vault-requests`
  })
  after(() => new Promise((resolve) => server.close(resolve)))
  const post = (payload) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  it('rejects missing, malformed, nonfinite, inconsistent and over-capacity terms', () => {
    assert.equal(validDetails(incentiveBody), true)
    const bad = [
      { incentive: undefined }, { kind: undefined }, { kind: 'other' }, { chain: 'arbitrum' },
      { depositAmount: '1001' }, { depositToken: 'USDC' }, { pair: 'CASHCAT / USDG' },
      ...[ ['durationDays', 0], ['durationDays', 1.5], ['durationDays', 3651],
        ['capacityUsd', 999], ['capacityUsd', Infinity], ['aprPercent', -1], ['aprPercent', NaN],
        ['slippageBps', 5000], ['range', 'custom'], ['chainId', 42161], ['poolAddress', '0x123'],
        ['quote', { ...incentiveBody.incentive.quote, cashcatAmount: -1 }],
        ['quote', { ...incentiveBody.incentive.quote, quotedAt: 'yesterday' }],
      ].map(([key, value]) => ({ incentive: { ...incentiveBody.incentive, [key]: value } })),
    ]
    for (const mutation of bad) assert.equal(validDetails({ ...incentiveBody, ...mutation }), false)
  })
  const edits = {
    duration: (t) => { t.durationDays = 4 }, capacity: (t) => { t.capacityUsd = 200000 },
    APR: (t) => { t.aprPercent = 800 }, pool: (t) => { t.poolAddress = RECIPIENT },
    'pair token address': (t) => { t.token1.address = RECIPIENT },
    'token decimals': (t) => { t.token1.decimals = 6 },
    slippage: (t) => { t.slippageBps = 100 }, 'offer ID': (t) => { t.id = 'changed-offer' },
    'quoted deposit tokens': (t) => { t.quote.cashcatAmount += 1 },
    'quoted quote-token amount': (t) => { t.quote.quoteAmount += 1 },
    'quoted USD reward': (t) => { t.quote.rewardUsd += 1 },
    'quoted CASHCAT reward': (t) => { t.quote.rewardCashcat += 1 },
    'CASHCAT price': (t) => { t.quote.cashcatUsd += 1 },
    'quote-token price': (t) => { t.quote.quoteTokenUsd += 1 },
    'pool spot price': (t) => { t.quote.quotePerCashcat += 1 },
    'quote timestamp': (t) => { t.quote.quotedAt = '2026-09-06T11:00:00.000Z' },
  }
  for (const [name, edit] of Object.entries(edits)) {
    it(`rejects post-signature changes to ${name}`, async () => {
      const changed = structuredClone(incentiveBody)
      edit(changed.incentive)
      assert.equal(validDetails(changed), true)
      assert.equal((await post({ ...changed, signature })).status, 401)
    })
  }
  it('binds the deposit value and human-readable pair as well as nested terms', async () => {
    for (const edit of [
      (v) => { v.depositAmount = v.incentive.depositUsd = '2000' },
      (v) => { v.pair = 'CASHCAT / USDG'; v.incentive.token1.symbol = 'USDG' },
    ]) {
      const changed = structuredClone(incentiveBody); edit(changed)
      assert.equal(validDetails(changed), true)
      assert.equal((await post({ ...changed, signature })).status, 401)
    }
  })
  it('stores all signed terms once and excludes unsupported unsigned metadata', async () => {
    const response = await post({ ...incentiveBody, signature, incentive: { ...incentiveBody.incentive, unsignedExtra: 'not part of the request' } })
    assert.equal(response.status, 201)
    const [record] = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(record.kind, 'incentive')
    assert.equal(record.depositToken, 'USD'); assert.equal(record.depositAmount, '1000')
    assert.equal(record.paymentChainId, 42161); assert.equal(record.incentive.chainId, 4663)
    assert.deepEqual(record.incentive, canonicalIncentive(incentiveBody.incentive))
    assert.equal(record.incentive.unsignedExtra, undefined)
    assert.equal((await post({ ...incentiveBody, signature })).status, 200)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).length, 1)
  })
  it('rejects a different fully signed incentive for an already-used payment', async () => {
    const changed = structuredClone(incentiveBody); changed.incentive.durationDays = 4
    const signature = await account.signMessage({ message: requestMessage(changed) })
    assert.equal((await post({ ...changed, signature })).status, 409)
  })
})

describe('request and payment validation', () => {
  it('requires positive bounded decimal amounts and bounded single-line fields', () => {
    assert.equal(validDetails(body), true)
    for (const depositAmount of ['0', '0.000', '-1', 'NaN', 'Infinity', '1e3', '1.2.3', '1'.repeat(51)]) {
      assert.equal(validDetails({ ...body, depositAmount }), false, depositAmount)
    }
    for (const depositToken of ['', ' ', 'X'.repeat(81), 'USDC\nWallet: impostor']) {
      assert.equal(validDetails({ ...body, depositToken }), false)
    }
    assert.equal(validDetails({ ...body, chain: 'unknown' }), false)
  })
  it('accepts an independently confirmed native Arbitrum USDC transfer', async () => {
    assert.equal((await verifyPayment(body, paymentFixture(account.address).rpc)).blockNumber, '0x64')
  })
  const mutations = {
    'reverted receipt': (f) => { f.receipt.status = '0x0' },
    'noncanonical wallet receipt': (f) => { f.receipt.status = 1 },
    'wrong sender': (f) => { f.tx.from = RECIPIENT },
    'wrong token': (f) => { f.tx.to = RECIPIENT },
    'wrong transaction hash': (f) => { f.receipt.transactionHash = `0x${'ff'.repeat(32)}` },
    'mismatched block': (f) => { f.tx.blockHash = `0x${'ff'.repeat(32)}` },
    'missing actual transfer': (f) => { f.receipt.logs = [] },
    'removed transfer event': (f) => { f.receipt.logs[0].removed = true },
    'wrong event amount': (f) => { f.receipt.logs[0].data = `0x${'0'.repeat(63)}1` },
    'wrong event token': (f) => { f.receipt.logs[0].address = RECIPIENT },
    'native value attached': (f) => { f.tx.value = '0x1' },
    'trailing calldata': (f) => { f.tx.input += '00' },
  }
  for (const [name, mutate] of Object.entries(mutations)) {
    it(`rejects ${name}`, async () => {
      const fixture = paymentFixture(account.address)
      mutate(fixture)
      await assert.rejects(verifyPayment(body, fixture.rpc))
    })
  }
  for (const [name, method, value] of [
    ['wrong RPC network', 'eth_chainId', '0x1'],
    ['unmined payment', 'eth_getTransactionReceipt', null],
    ['one confirmation', 'eth_blockNumber', '0x64'],
    ['reorganized block', 'eth_getBlockByNumber', { hash: `0x${'cc'.repeat(32)}` }],
  ]) {
    it(`rejects ${name}`, async () => {
      const fixture = paymentFixture(account.address)
      await assert.rejects(verifyPayment(body, (m, p) => m === method ? value : fixture.rpc(m, p)))
    })
  }
})

describe('durable request storage', () => {
  it('serializes concurrent writes, preserves retries, and survives reopening', async () => {
    const path = join(directory, 'concurrent.json')
    const save = createRequestStore(path)
    const record = { id: 'first', paymentTxHash: HASH, requestDigest: 'same', status: 'paid_waiting_for_vault' }
    const results = await Promise.all([save(record), save(record), save({ ...record, id: 'second', paymentTxHash: `0x${'34'.repeat(32)}` })])
    assert.deepEqual(results.map((r) => r.created), [true, false, true])
    assert.equal(JSON.parse(await readFile(path, 'utf8')).length, 2)
    if (process.platform !== 'win32') assert.equal((await stat(path)).mode & 0o777, 0o600)
    assert.equal((await createRequestStore(path)(record)).created, false)
    await assert.rejects(save({ ...record, requestDigest: 'changed' }), /different request/)
  })
  it('never overwrites corrupted or non-array queue contents', async () => {
    for (const text of ['{corrupt', '{"not":"a queue"}']) {
      const path = join(directory, `corrupt-${text.length}.json`)
      await writeFile(path, text)
      await assert.rejects(createRequestStore(path)({ paymentTxHash: HASH }))
      assert.equal(await readFile(path, 'utf8'), text)
    }
  })
})

describe('real HTTP request API', () => {
  let server, url, signature
  const path = join(directory, 'http.json')
  before(async () => {
    signature = await account.signMessage({ message: requestMessage(body) })
    const handler = createVaultRequestHandler({ recipient: RECIPIENT, storePath: path, basePath: '/app', rpc: paymentFixture(account.address).rpc })
    server = createServer(async (req, res) => {
      if (!await handler(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end() }
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    url = `http://127.0.0.1:${server.address().port}/app/vault-requests`
  })
  after(() => new Promise((resolve) => server.close(resolve)))
  const post = (payload) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) })
  it('exposes public config but never a queue listing', async () => {
    const response = await fetch(`${url}/config`)
    const config = await response.json()
    assert.equal(config.enabled, true)
    assert.equal(config.token, REQUEST_PAYMENT.token)
    assert.equal(response.headers.get('cache-control'), 'no-store')
    assert.equal((await fetch(url)).status, 405)
    assert.equal((await fetch(`${url}/queue`)).status, 404)
  })
  it('requires wallet ownership and binds it to every request field', async () => {
    assert.equal((await post(body)).status, 400)
    const wrong = await stranger.signMessage({ message: requestMessage(body) })
    assert.equal((await post({ ...body, signature: wrong })).status, 401)
    assert.equal((await post({ ...body, signature, pair: 'OTHER / USDC' })).status, 401)
  })
  it('creates once and returns the same ID after a lost-response retry', async () => {
    const first = await post({ ...body, signature })
    assert.equal(first.status, 201)
    const saved = await first.json()
    const retry = await post({ ...body, signature })
    assert.equal(retry.status, 200)
    assert.deepEqual(await retry.json(), saved)
    assert.equal(JSON.parse(await readFile(path, 'utf8')).length, 1)
  })
  it('rejects a second signed request for the same payment', async () => {
    const changed = { ...body, pair: 'ANOTHER / PAIR' }
    const signed = await account.signMessage({ message: requestMessage(changed) })
    assert.equal((await post({ ...changed, signature: signed })).status, 409)
  })
  it('rejects malformed JSON and incorrect content types', async () => {
    assert.equal((await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{' })).status, 400)
    assert.equal((await fetch(url, { method: 'POST', body: '{}' })).status, 415)
  })
  it('rejects an oversized request without dropping the HTTP response', async () => {
    const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'x'.repeat(16_385) })
    assert.equal(response.status, 413)
  })
  it('returns a bounded error for storage failure without leaking a path', async () => {
    await writeFile(path, '{corrupt')
    const response = await post({ ...body, signature })
    assert.equal(response.status, 503)
    assert.doesNotMatch(await response.text(), /\/tmp\/|EACCES|SyntaxError|corrupt/)
    assert.equal(await readFile(path, 'utf8'), '{corrupt')
  })
})
