import assert from 'node:assert/strict'
import { it } from 'node:test'
import { createServer } from 'node:http'
import { createFixedIncomeHandoff, HandoffError } from '../server/fixed-income-handoff.mjs'
import { createVaultRequestHandler } from '../server/vault-requests.mjs'
import { depositCents } from '../shared/vault-sizing.mjs'
import { USD_TOKEN_ADDRESS } from '../server/request-database.mjs'
import { decodeAdminCreateVaultUrlParams } from '../vendor/fixed-income-api/createVaultUrlParams.mjs'

const row = { requestId: 'ABC123DEF456', chainId: 4663, submitterAddress: '0x' + '11'.repeat(20), status: 'pending',
  token0Address: '0x' + '22'.repeat(20), token1Address: '0x' + '33'.repeat(20), poolAddress: '0x' + '44'.repeat(20),
  adapterType: 'fullRange', feeTier: 10000, minTick: null, maxTick: null, durationSeconds: 14 * 86400,
  fixedCapacityTokenAddress: USD_TOKEN_ADDRESS, fixedCapacityAmount: '100029', variableAssetAddress: '0x' + '22'.repeat(20),
  variableAssetAmount: null, useTargetApr: true, targetApr: 12, createdVaultAddress: null, display: { depositUsd: '1000.29' } }

function fixture(remote = row, fetcher) {
  const calls = []
  const handoff = createFixedIncomeHandoff({ frontendUrl: 'https://fixed-income.example/app/', apiUrl: 'http://127.0.0.1:3219/api-host/',
    fetchImpl: async (...args) => {
      calls.push(args)
      return fetcher ? fetcher(...args) : new Response(JSON.stringify({ success: true, data: remote ? [remote] : [] }))
    } })
  return { handoff, calls }
}

it('uses exact cents, accepting trailing zeroes but never rounding a signed deposit', () => {
  for (const [value, cents] of [['0.29','29'], ['1000.01','100001'], ['1000000000000','100000000000000'], ['0001.2300','123']]) {
    assert.equal(depositCents(value), cents)
  }
  for (const value of ['0', '0.001', '1.239', '1000000000000.01', '1e3', '-1', null, 100]) assert.equal(depositCents(value), null)
})

it('reuses the FI creation URL contract with the selected size and exact day/APR units', async () => {
  const { handoff, calls } = fixture({ ...row, minTick: undefined, maxTick: undefined, variableAssetAmount: undefined, createdVaultAddress: undefined })
  const url = new URL(await handoff(row, 'create'))
  assert.equal(url.origin + url.pathname, 'https://fixed-income.example/app/network/robinhood/admin/create-vault')
  const values = decodeAdminCreateVaultUrlParams(url.searchParams)
  assert.equal(values.fixedCapacityUsd, 1000.29); assert.equal(values.days, 14)
  assert.equal(values.targetApr, 12); assert.equal(values.useTargetApr, true)
  assert.equal(values.requestId, row.requestId); assert.equal(values.feeTier, 10000)
  assert.equal(values.variableAsset, row.variableAssetAddress); assert.equal(values.variableAmount, undefined)
  assert.equal(calls.length, 1)
  assert.equal(calls[0][0], `http://127.0.0.1:3219/api-host/api/v1/pending-vaults/4663/my-submissions/${row.submitterAddress}`)
  assert.equal(calls[0][1].redirect, 'error'); assert.equal(calls[0][1].body, undefined)
})

it('only opens side-specific vault entries after the same request is created in FI', async () => {
  const created = { ...row, status: 'created', createdVaultAddress: '0x' + 'AB'.repeat(20) }
  const { handoff } = fixture(created)
  for (const side of ['fixed','variable']) assert.equal(await handoff(created, side),
    `https://fixed-income.example/app/network/robinhood/vault/${created.createdVaultAddress.toLowerCase()}/${side}`)
  await assert.rejects(handoff(created, 'create'), { status: 409 })
  await assert.rejects(handoff(row, 'fixed'), { status: 409 })
  await assert.rejects(handoff({ ...row, status: 'rejected' }, 'create'), { status: 409 })
})

it('blocks a missing/divergent queue, unsupported chain, retired size and arbitrary destinations', async () => {
  for (const change of [null, { ...row, fixedCapacityAmount: '10000000' }, { ...row, chainId: 1 },
    { ...row, status: 'created' }, { ...row, targetApr: 1 }, { ...row, durationSeconds: 86400 },
    { ...row, variableAssetAddress: row.token1Address }]) {
    await assert.rejects(fixture(change).handoff(row, 'create'), { status: 409 })
  }
  const { handoff, calls } = fixture()
  await assert.rejects(handoff({ ...row, fixedCapacityAmount: '10000000' }, 'create'), { status: 409 })
  await assert.rejects(handoff({ ...row, chainId: 1 }, 'create'), { status: 400 })
  await assert.rejects(handoff(row, 'https://untrusted.example'), { status: 400 })
  assert.equal(calls.length, 0)
})

it('fails closed on API errors, malformed/oversized responses and leaking upstream messages', async () => {
  for (const fetcher of [() => new Response('down', { status: 503 }), () => new Response('invalid'),
    () => new Response('x'.repeat(1_000_001)), () => { throw new Error('private-upstream-credential') }]) {
    await assert.rejects(fixture(row, fetcher).handoff(row, 'create'), error => error.status === 503 && !error.message.includes('credential'))
  }
})

it('requires explicit public app/API URLs and permits HTTP only on loopback', () => {
  assert.equal(createFixedIncomeHandoff(), null)
  for (const frontendUrl of ['javascript:alert(1)', 'https://user:secret@example.com', 'https://example.com/?token=x',
    'https://example.com/#x', 'http://external.example', '//external.example', undefined]) {
    assert.throws(() => createFixedIncomeHandoff({ frontendUrl, apiUrl: 'http://localhost:3001' }), /configuration/)
  }
  assert.throws(() => createFixedIncomeHandoff({ frontendUrl: 'https://example.com' }), /configuration/)
})

it('the handoff endpoint exposes only controlled errors and never internal exception text', async () => {
  let cause = new HandoffError(409, 'This request is no longer pending. Refresh requests.')
  const handler = createVaultRequestHandler({ basePath: '/app', database: {
    list: async options => { assert.deepEqual(options, { wallet: row.submitterAddress, requestId: row.requestId }); return [row] },
  }, handoff: async () => { throw cause } })
  const server = createServer((req, res) => void handler(req, res, new URL(req.url, 'http://localhost').pathname))
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  try {
    const url = `http://127.0.0.1:${server.address().port}/app/vault-requests/handoff?wallet=${row.submitterAddress}&requestId=${row.requestId}&action=create`
    const expected = await fetch(url)
    assert.equal(expected.status, 409); assert.equal((await expected.json()).error, cause.message)
    cause = Object.assign(new Error('private-upstream-credential'), { status: 409 })
    const unexpected = await fetch(url)
    assert.equal(unexpected.status, 503)
    assert.equal((await unexpected.json()).error, 'Vault handoff is unavailable. Retry without paying again.')
  } finally { await new Promise(resolve => server.close(resolve)) }
})
