import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createServer } from 'node:http'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createIncentiveProgramHandler } from '../server/incentive-programs.mjs'
import { createVaultRequestHandler } from '../server/vault-requests.mjs'
import { createRequestDatabase } from '../server/request-database.mjs'
import { programAdminMessage, validPair, validProgram } from '../shared/incentive-program.mjs'
import { requestMessage } from '../shared/vault-request.mjs'
import { postgresFixture } from './postgres-fixture.mjs'
import { PAIR, OFFER, requestDetails, catalogRpc } from './catalog-fixture.mjs'
import { paymentFixture, RECIPIENT, HASH } from './payment-fixture.mjs'
import { feeRpc } from './fee-fixture.mjs'

async function fixture() {
  const store = await postgresFixture()
  const owner = privateKeyToAccount(generatePrivateKey()), stranger = privateKeyToAccount(generatePrivateKey())
  const chain = paymentFixture(owner.address)
  const state = { owner: owner.address, now: Date.now() }
  const programs = createIncentiveProgramHandler({ database: store.database, adminOwner: async () => state.owner,
    basePath: '/lab', rpc: catalogRpc(), now: () => state.now })
  const requests = createVaultRequestHandler({ database: store.database, recipient: RECIPIENT,
    basePath: '/lab', rpc: feeRpc(chain), adminOwner: async () => state.owner })
  const server = createServer(async (req, res) => {
    const path = new URL(req.url, 'http://localhost').pathname
    if (!await programs(req, res, path) && !await requests(req, res, path)) { res.writeHead(404); res.end() }
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}/lab`
  const post = (path, body) => fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const challenge = async (action, payload, account = owner) => {
    const response = await post('/incentive-programs/admin/challenge', { wallet: account.address, action, payload })
    assert.equal(response.status, 200, await response.clone().text())
    const proof = await response.json()
    return { wallet: account.address, nonce: proof.nonce, signature: await account.signMessage({ message: programAdminMessage(proof) }) }
  }
  const execute = body => post('/incentive-programs/admin/execute', body)
  const save = async (action, payload) => {
    const response = await execute(await challenge(action, payload))
    assert.equal(response.status, 200, await response.clone().text())
    return response.json()
  }
  return { store, owner, stranger, state, post, base, challenge, execute, save,
    async close() { await new Promise(resolve => server.close(resolve)); await store.close() } }
}

it('rejects metadata and decimal precision that cannot survive the request schema', () => {
  assert.equal(validProgram({ ...OFFER, apr: 1.23, capacityUsd: 10.29 }), true)
  for (const value of [{ apr: 0.001 }, { apr: 1.234 }, { capacityUsd: 0.001 }, { capacityUsd: 10.291 }, { days: 1.5 }]) {
    assert.equal(validProgram({ ...OFFER, ...value }), false)
  }
  assert.equal(validPair({ ...PAIR, token0: { ...PAIR.token0, symbol: undefined } }), false)
  assert.equal(validPair({ ...PAIR, token1: PAIR.token0 }), false)
})

it('bootstraps the existing catalog once and retains admin edits across initialization', async () => {
  const f = await fixture()
  try {
    let catalog = await f.store.database.catalog(true)
    assert.equal(catalog.pairs.length, 1); assert.equal(catalog.programs.length, 4)
    assert.equal((await f.store.database.catalog()).offers[0].isNew, true)
    const edited = await f.store.database.saveProgram({ ...catalog.programs[0], apr: 550, active: false }, f.owner.address)
    const restarted = createRequestDatabase({ connection: f.store.database.pool.options })
    try {
      await restarted.ready
      catalog = await restarted.catalog(true)
      assert.equal(catalog.programs.length, 4)
      assert.deepEqual(catalog.programs.find(row => row.id === edited.id), edited)
      assert.equal((await restarted.catalog()).offers.length, 3)
    } finally { await restarted.close() }
  } finally { await f.close() }
})

it('requires the current factory owner, a valid action-bound signature, and a single-use unexpired proof', async () => {
  const f = await fixture()
  try {
    assert.equal((await f.post('/incentive-programs/admin/challenge', { wallet: f.stranger.address, action: 'list' })).status, 403)
    assert.equal((await f.post('/incentive-programs/admin/challenge', { wallet: f.owner.address, action: 'save-program', payload: { ...OFFER, apr: -1 } })).status, 400)
    const proof = await f.challenge('list')
    const wrong = await f.stranger.signMessage({ message: 'Not the admin message' })
    assert.equal((await f.execute({ ...proof, signature: wrong })).status, 401)
    assert.equal((await f.execute(proof)).status, 200)
    assert.equal((await f.execute(proof)).status, 401)
    const expired = await f.challenge('list')
    f.state.now += 5 * 60_000
    assert.equal((await f.execute(expired)).status, 401)
    const handoff = await f.challenge('list')
    f.state.owner = f.stranger.address
    assert.equal((await f.execute(handoff)).status, 403)
    const saved = await f.store.database.catalog(true)
    assert.equal(saved.programs[0].apr, 1000)
  } finally { await f.close() }
})

it('stores signed pair/program edits, validates pool metadata, and hides paused pairs', async () => {
  const f = await fixture()
  try {
    const bad = await f.challenge('save-pair', { ...PAIR, feeTier: 500 })
    assert.equal((await f.execute(bad)).status, 400)
    const wrongDecimals = await f.challenge('save-pair', { ...PAIR, token0: { ...PAIR.token0, decimals: 6 } })
    assert.equal((await f.execute(wrongDecimals)).status, 400)
    let result = await f.save('save-pair', { ...PAIR, id: 'another-pair', revision: 0, token0: { ...PAIR.token0, symbol: 'CAT' } })
    assert.equal(result.pairs.length, 2)
    const newProgram = { ...OFFER, id: 'weekly-reward', revision: 0, pairId: 'another-pair', days: 7, apr: 50, sortOrder: -1, isNew: false }
    result = await f.save('save-program', newProgram)
    const publicCatalog = await (await fetch(f.base + '/incentive-programs')).json()
    assert.equal(publicCatalog.offers[0].id, 'weekly-reward')
    assert.equal(publicCatalog.offers[0].token0.symbol, 'CAT')
    assert.equal(publicCatalog.offers[0].pool, PAIR.pool)
    assert.equal(publicCatalog.pairs, undefined, 'Public catalog does not expose the admin inventory')
    const row = (await f.store.database.pool.query("SELECT updated_by FROM liqifi.incentive_programs WHERE id='weekly-reward'")).rows[0]
    assert.equal(row.updated_by, f.owner.address.toLowerCase())
    await f.save('save-pair', { ...result.pairs.find(pair => pair.id === 'another-pair'), active: false })
    assert.equal((await f.store.database.catalog()).offers.length, 4)
  } finally { await f.close() }
})

it('rejects stale competing edits and prevents list proofs from authorizing injected writes', async () => {
  const f = await fixture()
  try {
    const original = (await f.store.database.catalog(true)).programs[0]
    const first = await f.challenge('save-program', { ...original, apr: 600 })
    const competing = await f.challenge('save-program', { ...original, apr: 900 })
    assert.equal((await f.execute(first)).status, 200)
    assert.equal((await f.execute(competing)).status, 409)
    const read = await f.challenge('list')
    assert.equal((await f.execute({ ...read, action: 'save-program', payload: { ...original, apr: 100000 } })).status, 200)
    assert.equal((await f.store.database.catalog(true)).programs[0].apr, 600)
  } finally { await f.close() }
})

it('checks current catalog terms before fees, but retains paid terms after pair edits and program pauses', async () => {
  const f = await fixture()
  try {
    const details = requestDetails()
    const quoteBody = { wallet: f.owner.address, asset: 'USDC', details }
    assert.equal((await f.post('/vault-requests/quote', { wallet: f.owner.address, asset: 'USDC' })).status, 400)
    const forged = structuredClone(quoteBody); forged.details.incentive.aprPercent = 50000
    assert.equal((await f.post('/vault-requests/quote', forged)).status, 409)
    const quoteResponse = await f.post('/vault-requests/quote', quoteBody)
    assert.equal(quoteResponse.status, 200)
    const quote = await quoteResponse.json()
    const row = (await f.store.database.catalog(true)).programs[0]
    await f.store.database.saveProgram({ ...row, active: false }, f.owner.address)
    await f.store.database.savePair({ ...PAIR, token0: { ...PAIR.token0, symbol: 'RENAMED' } }, f.owner.address)
    assert.equal((await f.post('/vault-requests/quote', quoteBody)).status, 409)
    const body = { ...details, wallet: f.owner.address, recipient: RECIPIENT, paymentTxHash: HASH,
      payment: { asset: 'USDC', amountRaw: quote.amountRaw, quoteId: quote.id } }
    body.signature = await f.owner.signMessage({ message: requestMessage(body) })
    assert.equal((await f.post('/vault-requests', body)).status, 201)
    assert.equal((await f.post('/vault-requests', body)).status, 200)
    const altered = structuredClone(body); altered.incentive.aprPercent = 100000
    altered.signature = await f.owner.signMessage({ message: requestMessage(altered) })
    assert.equal((await f.post('/vault-requests', altered)).status, 402)
    const [saved] = await f.store.records()
    assert.equal(saved.incentive.aprPercent, 1000); assert.equal(saved.incentive.token0.symbol, 'CASHCAT')
  } finally { await f.close() }
})

it('limits methods and bodies, preserves the base path, and reports outages separately from an empty catalog', async () => {
  const f = await fixture()
  try {
    assert.equal((await fetch(f.base + '/incentive-programs/admin/challenge')).status, 405)
    assert.equal((await f.post('/incentive-programs', {})).status, 405)
    assert.equal((await f.post('/incentive-programs/admin/challenge', { junk: 'x'.repeat(17_000) })).status, 413)
    assert.equal((await fetch(f.base + '/incentive-programs/unknown')).status, 404)
    assert.equal((await fetch(f.base.replace('/lab', '') + '/incentive-programs')).status, 404)
    await f.store.database.pool.query('UPDATE liqifi.incentive_programs SET active=FALSE')
    assert.deepEqual((await (await fetch(f.base + '/incentive-programs')).json()).offers, [])
    await f.store.database.pool.query('ALTER TABLE liqifi.incentive_programs RENAME TO unavailable_programs')
    assert.equal((await fetch(f.base + '/incentive-programs')).status, 503)
  } finally { await f.close() }
})
