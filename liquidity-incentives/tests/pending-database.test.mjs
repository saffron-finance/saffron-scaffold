import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { it } from 'node:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keccak256, stringToHex } from 'viem'
import { createRequestDatabase, USD_TOKEN_ADDRESS } from '../server/request-database.mjs'
import { createVaultRequestHandler, verifyPayment } from '../server/vault-requests.mjs'
import { createFeeService, ethFeeRaw } from '../server/request-fees.mjs'
import { requestMessage, validDetails } from '../shared/vault-request.mjs'
import { adminListMessage } from '../shared/request-admin.mjs'
import { postgresFixture } from './postgres-fixture.mjs'
import { feeRpc } from './fee-fixture.mjs'
import { HASH, RECIPIENT, paymentFixture } from './payment-fixture.mjs'

const account = privateKeyToAccount(generatePrivateKey())
const stranger = privateKeyToAccount(generatePrivateKey())
// Independent expected FI units: 3 days = 259200 seconds, $100k = 10m
// cents, 1000% APR = decimal 10. The user's $10 intent is NOT capacity.
const details = { version: 3, kind: 'incentive', chain: 'robinhood', depositToken: 'USD', pair: 'CASHCAT / ETH', depositAmount: '10',
  incentive: { id: 'cashcat-eth-1000-3d', chainId: 4663, poolAddress: '0xA70fc67C9F69da90B63a0e4C05D229954574E313', feeTier: 10000,
    token0: { address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4', symbol: 'CASHCAT', decimals: 18 },
    token1: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'ETH', decimals: 18 },
    durationDays: 3, capacityUsd: 100000, aprPercent: 1000, depositUsd: '10', range: 'full',
    quote: { cashcatAmount: 2500, quoteAmount: 0.0025, rewardUsd: 10 * 10 * 3 / 365,
      rewardCashcat: 10 * 10 * 3 / 365 / 0.002, cashcatUsd: 0.002, quoteTokenUsd: 2000,
      quotePerCashcat: 0.000001, quotedAt: '2026-09-06T10:00:00.000Z' } } }

/** Actual HTTP and PostgreSQL, with only chain/wallet identities replaced by local fixtures. */
async function apiFixture(asset = 'USDC') {
  const store = await postgresFixture()
  const chain = paymentFixture(account.address)
  if (asset === 'ETH') {
    Object.assign(chain.tx, { to: RECIPIENT, input: '0x', value: '0x' + (10n ** 15n).toString(16) })
    Object.assign(chain.receipt, { to: RECIPIENT, logs: [] })
  }
  const handler = createVaultRequestHandler({ recipient: RECIPIENT, database: store.database,
    basePath: '/app', rpc: feeRpc(chain), adminOwner: async () => account.address })
  const server = createServer(async (req, res) => {
    if (!await handler(req, res, new URL(req.url, 'http://localhost').pathname)) { res.writeHead(404); res.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/app/vault-requests`
  const post = (path, body) => fetch(url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const quoted = await post('/quote', { wallet: account.address, asset, details }); assert.equal(quoted.status, 200)
  const quote = await quoted.json()
  const body = { ...structuredClone(details), wallet: account.address, recipient: RECIPIENT, paymentTxHash: HASH,
    payment: { asset, amountRaw: quote.amountRaw, quoteId: quote.id } }
  body.signature = await account.signMessage({ message: requestMessage(body) })
  return { store, chain, body, post, url, async close() { await new Promise((resolve) => server.close(resolve)); await store.close() } }
}

it('uses exactly the fixed-income pending_vaults columns, numeric units and nullability', async () => {
  const f = await postgresFixture()
  try {
    const { rows } = await f.database.pool.query(`SELECT column_name,data_type,is_nullable,numeric_precision,numeric_scale
      FROM information_schema.columns WHERE table_schema='uniswap_v3_fiv' AND table_name='pending_vaults'`)
    const expected = ['id','request_id','chain_id','submitter_address','status','token0_address','token1_address','pool_address','fee_tier',
      'adapter_type','min_tick','max_tick','duration_seconds','fixed_capacity_token_address','fixed_capacity_amount',
      'variable_asset_address','variable_asset_amount','use_target_apr','target_apr','notes','admin_notes','reviewed_by','reviewed_at',
      'created_vault_address','created_at','updated_at','is_advanced_mode','telegram_chat_id','telegram_message_id',
      'submitter_telegram','submitter_discord','rejection_reason']
    assert.deepEqual(rows.map((r) => r.column_name).sort(), expected.sort())
    const byName = Object.fromEntries(rows.map((r) => [r.column_name, r]))
    assert.equal(byName.duration_seconds.data_type, 'bigint')
    assert.equal(byName.fixed_capacity_amount.numeric_precision, 78); assert.equal(byName.fixed_capacity_amount.numeric_scale, 0)
    assert.equal(byName.target_apr.numeric_precision, 10); assert.equal(byName.target_apr.numeric_scale, 4)
    assert.equal(byName.fixed_capacity_amount.is_nullable, 'YES'); assert.equal(byName.variable_asset_amount.is_nullable, 'YES')
  } finally { await f.close() }
})

for (const asset of ['USDC', 'ETH']) it(`${asset}: quote → signed payment → PostgreSQL → user and authenticated admin views`, async () => {
  const f = await apiFixture(asset)
  try {
    const unsigned = { ...f.body }; delete unsigned.signature
    assert.equal((await f.post('', unsigned)).status, 400)
    assert.equal((await f.store.records()).length, 0, 'No pending request before the user signs')
    const wrong = { ...f.body, signature: await stranger.signMessage({ message: requestMessage(f.body) }) }
    assert.equal((await f.post('', wrong)).status, 401)
    assert.equal((await f.store.records()).length, 0)
    const response = await f.post('', f.body); assert.equal(response.status, 201)
    const saved = await response.json(); assert.match(saved.id, /^[A-Z0-9]{12}$/)
    assert.equal((await f.post('', f.body)).status, 200)
    assert.equal((await f.store.records()).length, 1)
    const row = (await f.store.database.pool.query('SELECT * FROM uniswap_v3_fiv.pending_vaults')).rows[0]
    assert.equal(row.status, 'pending'); assert.equal(row.duration_seconds, '259200')
    assert.equal(row.fixed_capacity_token_address, USD_TOKEN_ADDRESS); assert.equal(row.fixed_capacity_amount, '10000000')
    assert.equal(row.target_apr, '10.0000'); assert.equal(row.variable_asset_amount, null)
    assert.equal(row.variable_asset_address, details.incentive.token0.address.toLowerCase())
    assert.equal(row.fee_tier, 10000)
    await f.store.database.pool.query("UPDATE uniswap_v3_fiv.pending_vaults SET admin_notes='Internal test note',submitter_telegram='private-contact',reviewed_by=$1", [RECIPIENT])
    const mine = await (await fetch(f.url + '/my?wallet=' + account.address)).json()
    assert.equal(mine.data.length, 1); assert.equal(mine.data[0].requestId, saved.id)
    assert.equal(mine.data[0].display.paymentAsset, asset)
    assert.equal(mine.data[0].display.depositUsd, '10')
    assert.equal(mine.data[0].adminNotes, undefined); assert.equal(mine.data[0].reviewedBy, undefined)
    assert.doesNotMatch(JSON.stringify(mine), /Internal test note|private-contact|signature|quoteId/)
    const other = await (await fetch(f.url + '/my?wallet=' + stranger.address)).json()
    assert.deepEqual(other.data, [])
    assert.equal((await f.post('/admin/challenge', { wallet: stranger.address, chainId: 4663 })).status, 403)
    const challenge = await (await f.post('/admin/challenge', { wallet: account.address, chainId: 4663 })).json()
    const proof = { ...challenge, signature: await account.signMessage({ message: adminListMessage(challenge) }) }
    const admin = await f.post('/admin/list', proof); assert.equal(admin.status, 200)
    assert.equal((await admin.json()).data[0].adminNotes, 'Internal test note')
    assert.equal((await f.post('/admin/list', proof)).status, 401, 'Admin nonce cannot be replayed')
  } finally { await f.close() }
})

it('v3 fee selection, quote and amount cannot change after signing or bypass the stored quote', async () => {
  const f = await apiFixture()
  try {
    for (const mutation of [{ asset: 'ETH' }, { amountRaw: '1000000' }, { quoteId: '00000000-0000-4000-8000-000000000000' }]) {
      const changed = { ...f.body, payment: { ...f.body.payment, ...mutation } }
      assert.equal((await f.post('', changed)).status, 401)
      changed.signature = await account.signMessage({ message: requestMessage(changed) })
      assert.equal((await f.post('', changed)).status, 402)
    }
    assert.equal((await f.store.records()).length, 0)
    assert.equal(validDetails({ ...details, incentive: { ...details.incentive, slippageBps: 50 } }), false)
  } finally { await f.close() }
})

it('rejects ETH payments mined at or after expiry without saving a request', async () => {
  const f = await apiFixture('ETH')
  try {
    const expiry = 1_700_000_000n
    await f.store.database.pool.query('UPDATE liqifi.request_fee_quotes SET expires_at=$1 WHERE id=$2',
      [new Date(Number(expiry) * 1000), f.body.payment.quoteId])
    for (const delay of [0n, 1n, 7n * 86400n]) {
      f.chain.block.timestamp = '0x' + (expiry + delay).toString(16)
      const response = await f.post('', f.body)
      assert.equal(response.status, 402)
      const { error } = await response.json()
      assert.match(error, /mined after its quote expired/)
      assert.match(error, /do not pay again/)
    }
    assert.equal((await f.store.records()).length, 0)
    assert.equal((await f.store.database.pool.query('SELECT count(*) FROM uniswap_v3_fiv.pending_vaults')).rows[0].count, '0')
  } finally { await f.close() }
})

it('accepts and deduplicates on-time ETH payments submitted after quote expiry', async () => {
  const f = await apiFixture('ETH')
  try {
    const expiry = 1_700_000_000n
    await f.store.database.pool.query('UPDATE liqifi.request_fee_quotes SET expires_at=$1 WHERE id=$2',
      [new Date(Number(expiry) * 1000), f.body.payment.quoteId])
    f.chain.block.timestamp = '0x' + (expiry - 1n).toString(16)
    const first = await f.post('', f.body)
    assert.equal(first.status, 201)
    const retry = await f.post('', f.body)
    assert.equal(retry.status, 200)
    assert.deepEqual(await retry.json(), await first.json())
    assert.equal((await f.store.records()).length, 1)
  } finally { await f.close() }
})

it('fails closed on unavailable or noncanonical ETH payment block times', async () => {
  const f = await apiFixture('ETH')
  try {
    for (const timestamp of [undefined, null, 'invalid', '0x', '0x0', '-1', 1_700_000_000]) {
      f.chain.block.timestamp = timestamp
      assert.equal((await f.post('', f.body)).status, 402)
    }
    f.chain.block.timestamp = '0x1'
    f.chain.block.hash = '0x' + 'ff'.repeat(32)
    const response = await f.post('', f.body)
    assert.equal(response.status, 402)
    assert.match((await response.json()).error, /not canonical/)
    assert.equal((await f.store.records()).length, 0)
  } finally { await f.close() }
})

it('keeps the fixed 2 USDC fee resumable after quote expiry', async () => {
  const f = await apiFixture('USDC')
  try {
    await f.store.database.pool.query('UPDATE liqifi.request_fee_quotes SET expires_at=$1 WHERE id=$2',
      [new Date(1_700_000_000_000), f.body.payment.quoteId])
    assert.equal((await f.post('', f.body)).status, 201)
    assert.equal((await f.post('', f.body)).status, 200)
    assert.equal((await f.store.records()).length, 1)
  } finally { await f.close() }
})

it('retries a failed startup once after cooldown and restores payment configuration', async () => {
  const f = await postgresFixture()
  let time = 0, attempts = 0
  const pool = {
    on() {}, end: async () => {}, query: (...args) => f.database.pool.query(...args),
    async connect() {
      if (++attempts === 1) throw new Error('Temporary test connection failure')
      return f.database.pool.connect()
    },
  }
  const recovered = createRequestDatabase({ pool, now: () => time })
  const handler = createVaultRequestHandler({ recipient: RECIPIENT, database: recovered,
    basePath: '', rpc: feeRpc(paymentFixture(account.address)) })
  const server = createServer(async (req, res) => handler(req, res, new URL(req.url, 'http://localhost').pathname))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const config = async () => (await fetch(`http://127.0.0.1:${server.address().port}/vault-requests/config`)).json()
  try {
    await assert.rejects(recovered.ready, /Temporary test connection failure/)
    assert.equal((await config()).enabled, false)
    time = 4999
    await assert.rejects(recovered.health())
    assert.equal(attempts, 1)
    time = 5000
    const retry = recovered.ready
    assert.equal(recovered.ready, retry, 'Concurrent callers must share the retry')
    await Promise.all([retry, recovered.health(), recovered.list({ wallet: account.address })])
    assert.equal(attempts, 2)
    assert.equal((await config()).enabled, true)
    assert.deepEqual(await recovered.inquiries(account.address), [])
    await recovered.close()
    await assert.rejects(recovered.ready, /closed/)
    assert.equal(attempts, 2)
  } finally { await new Promise(resolve => server.close(resolve)); await f.close() }
})

it('retries an interrupted legacy import without duplicating already imported payments', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liqifi-import-retry-'))
  const path = join(directory, 'legacy.json')
  const records = [HASH, '0x' + '34'.repeat(32)].map(paymentTxHash => {
    const record = { ...structuredClone(details), id: 'VR-' + paymentTxHash.slice(2).toUpperCase(),
      wallet: account.address, status: 'paid_waiting_for_vault', createdAt: '2026-09-06T10:52:42.313Z',
      recipient: RECIPIENT, paymentTxHash, requestDigest: keccak256(stringToHex(paymentTxHash)) }
    delete record.version; delete record.incentive.feeTier; record.incentive.slippageBps = 50
    return record
  })
  const original = JSON.stringify(records)
  await writeFile(path, original)
  const f = await postgresFixture()
  let time = 0, feeReads = 0
  const recovered = createRequestDatabase({ pool: f.database.pool, legacyPath: path, now: () => time,
    resolvePoolFee: async () => { if (++feeReads === 2) throw new Error('Temporary legacy RPC failure'); return 10000 } })
  try {
    await assert.rejects(recovered.ready, /Temporary legacy RPC failure/)
    await assert.rejects(recovered.health())
    assert.equal((await f.records()).length, 1)
    const originalId = (await f.database.list({ wallet: account.address }))[0].requestId
    time = 5000
    await recovered.health()
    assert.equal((await f.records()).length, 2)
    assert.equal(feeReads, 3, 'The first payment must not be imported again')
    assert.ok((await recovered.list({ wallet: account.address })).some(row => row.requestId === originalId))
    assert.equal(await readFile(path, 'utf8'), original)
  } finally { await f.close() }
})

for (const field of ['to', 'value', 'input', 'status']) it(`native ETH verification rejects incorrect ${field}`, async () => {
  const chain = paymentFixture(account.address)
  Object.assign(chain.tx, { to: RECIPIENT, input: '0x', value: '0x' + (10n ** 15n).toString(16) })
  if (field === 'to') chain.tx.to = stranger.address
  if (field === 'value') chain.tx.value = '0x1'
  if (field === 'input') chain.tx.input = '0x1234'
  if (field === 'status') chain.receipt.status = '0x0'
  await assert.rejects(verifyPayment({ version: 3, wallet: account.address, recipient: RECIPIENT, paymentTxHash: HASH, payment: { asset: 'ETH', amountRaw: String(10n ** 15n) } }, chain.rpc))
})

it('concurrent duplicate payments create one compatible row and one receipt', async () => {
  const f = await apiFixture()
  try {
    const responses = await Promise.all(Array.from({ length: 4 }, () => f.post('', f.body)))
    assert.deepEqual(responses.map((r) => r.status).sort(), [200,200,200,201])
    assert.equal((await f.store.database.pool.query('SELECT count(*) FROM uniswap_v3_fiv.pending_vaults')).rows[0].count, '1')
    assert.equal((await f.store.records()).length, 1)
  } finally { await f.close() }
})

it('a sidecar-write failure rolls back the pending row instead of leaving partial data', async () => {
  const f = await apiFixture()
  try {
    await f.store.database.pool.query(`CREATE FUNCTION liqifi.fail_test() RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'test failure'; END; $$ LANGUAGE plpgsql;
      CREATE TRIGGER fail_test BEFORE INSERT ON liqifi.request_payments FOR EACH ROW EXECUTE FUNCTION liqifi.fail_test()`)
    assert.equal((await f.post('', f.body)).status, 503)
    assert.equal((await f.store.database.pool.query('SELECT count(*) FROM uniswap_v3_fiv.pending_vaults')).rows[0].count, '0')
    await f.store.database.pool.query('DROP TRIGGER fail_test ON liqifi.request_payments')
    assert.equal((await f.post('', f.body)).status, 201)
  } finally { await f.close() }
})

it('legacy JSON migration preserves the original request, ID and file without duplication', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'liqifi-migration-')); const path = join(directory, 'legacy.json')
  const legacy = { ...structuredClone(details), id: 'VR-' + HASH.slice(2).toUpperCase(), wallet: account.address,
    status: 'paid_waiting_for_vault', createdAt: '2026-09-06T10:52:42.313Z', recipient: RECIPIENT,
    paymentTxHash: HASH, requestDigest: keccak256(stringToHex('already verified legacy message')) }
  delete legacy.version; delete legacy.incentive.feeTier; legacy.incentive.slippageBps = 50
  const text = JSON.stringify([legacy]); await writeFile(path, text)
  const f = await postgresFixture({ legacyPath: path, resolvePoolFee: async () => 10000 })
  try {
    assert.equal((await f.records()).length, 1)
    const id = (await f.database.list({ wallet: account.address }))[0].requestId
    // Once imported, restarting must work even if historical pool RPC is down.
    const reopened = createRequestDatabase({ pool: f.database.pool, legacyPath: path,
      resolvePoolFee: async () => { throw new Error('Pool RPC unavailable on restart') } })
    await reopened.ready
    assert.equal((await reopened.list({ wallet: account.address }))[0].requestId, id)
    assert.equal((await f.records()).length, 1)
    assert.equal(await readFile(path, 'utf8'), text)
    assert.equal((await f.records())[0].id, legacy.id)
  } finally { await f.close() }
})

it('ETH quote conversion uses fresh prices and rounds up at most one wei', async () => {
  assert.equal(ethFeeRaw('200000000000'), 10n ** 15n)
  const price = 250123456789n, amount = ethFeeRaw(price)
  assert.ok(amount * price >= 200_000_000n * 10n ** 18n)
  assert.ok((amount - 1n) * price < 200_000_000n * 10n ** 18n)
  for (const options of [{ stale: true }, { sequencerDown: true }, { price: 0n }]) {
    const service = createFeeService({ rpc: feeRpc(paymentFixture(account.address), options), database: null, recipient: RECIPIENT })
    await assert.rejects(service.price())
  }
})
