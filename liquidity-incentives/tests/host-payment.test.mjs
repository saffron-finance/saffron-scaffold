import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'esbuild'
import { encodeFunctionData, erc20Abi, keccak256, stringToHex } from 'viem'
import { REQUEST_PAYMENT } from '../shared/vault-request.mjs'

// Bundle only the adapter under test; its browser host boundary is inert.
// RPC calls below are fixture reads and wallet writes deliberately throw.
const rpc = {}
globalThis.__featureLabTestRpc = rpc
const api = { request() { throw new Error('No HTTP permitted') } }
globalThis.__featureLabTestApi = api
const compiled = await build({ stdin: { contents: [
  "export * from './src/host/payment.ts'",
  "export * from './src/host/useOfferPrice.ts'",
  "export { readPendingRequest } from './src/host/useRequestFlow.ts'",
  "export { requestDraft, OFFERS } from './src/incentives/model.ts'",
].join(';'), resolveDir: resolve('.') }, bundle: true, write: false,
  define: { 'import.meta.env.BASE_URL': JSON.stringify('/fixture/') },
  format: 'esm', platform: 'node', alias: { '@receipt': resolve('shared/vault-request.mjs') },
  plugins: [{ name: 'no-live-payment', setup(builder) {
    builder.onResolve({ filter: /^@lab\/wallet\/wallet$|^\.\/transport$/ }, ({ path }) => ({ path, namespace: 'fixture' }))
    builder.onLoad({ filter: /.*/, namespace: 'fixture' }, ({ path }) => ({ contents: path === './transport'
      ? 'export const arbitrumClient = globalThis.__featureLabTestRpc; export const robinhoodClient = arbitrumClient; export const requestJson = (...args) => globalThis.__featureLabTestApi.request(...args)'
      : 'export function walletClient(){ throw new Error("No wallet writes permitted") }; export async function assertWalletAccount(){}; export async function ensureChain(){}' }))
  } }] })
const { assertPaymentEvidence, confirmPayment, PaymentRevertedError, preferredFeeAsset,
  loadPaymentConfig, quoteRequestPayment, payRequest, readOfferPrice, readPendingRequest, requestDraft, OFFERS } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`)
const address = (digit) => `0x${digit.repeat(40)}`
const hash = (digit) => `0x${digit.repeat(64)}`
const wallet = address('1'), recipient = address('2'), oldHash = hash('a'), replacementHash = hash('b')
const baseRequest = { wallet, recipient, paymentTxHash: oldHash }
const topicAddress = (value) => `0x${'0'.repeat(24)}${value.slice(2)}`

/** Valid mined USDC evidence can carry a speed-up hash instead of the original. */
function usdcEvidence() {
  const tx = { hash: replacementHash, from: wallet, to: REQUEST_PAYMENT.token, value: 0n,
    blockHash: hash('c'), blockNumber: 30n,
    input: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [recipient, 2_000_000n] }) }
  const receipt = { transactionHash: replacementHash, status: 'success', blockHash: tx.blockHash, blockNumber: tx.blockNumber,
    logs: [{ address: REQUEST_PAYMENT.token, data: hash('0').slice(0, -6) + '1e8480', removed: false,
      topics: [keccak256(stringToHex('Transfer(address,address,uint256)')), topicAddress(wallet), topicAddress(recipient)] }] }
  return { tx, receipt }
}

test('fee preference compares USD value rather than raw token counts', () => {
  assert.equal(preferredFeeAsset({ ETH: 10n ** 18n, USDC: 20_000_000n }, '200000000000'), 'ETH')
  assert.equal(preferredFeeAsset({ ETH: 10n ** 15n, USDC: 20_000_000n }, '200000000000'), 'USDC')
  assert.equal(preferredFeeAsset({ ETH: 10n ** 18n }, '200000000000'), 'USDC')
})

test('legacy USDC receipt accepts an exact successful speed-up payment', () => {
  const { tx, receipt } = usdcEvidence()
  assert.doesNotThrow(() => assertPaymentEvidence(baseRequest, tx, receipt))
})

test('successful cancellation cannot count as a fee', () => {
  const { tx, receipt } = usdcEvidence()
  assert.throws(() => assertPaymentEvidence(baseRequest, { ...tx, to: wallet, value: 0n, input: '0x' }, receipt))
})

test('USDC evidence rejects the wrong wallet, recipient, amount or missing transfer event', () => {
  const { tx, receipt } = usdcEvidence()
  assert.throws(() => assertPaymentEvidence(baseRequest, { ...tx, from: address('3') }, receipt))
  for (const args of [[wallet, 2_000_000n], [recipient, 1_000_000n]]) {
    assert.throws(() => assertPaymentEvidence(baseRequest, { ...tx,
      input: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args }) }, receipt))
  }
  assert.throws(() => assertPaymentEvidence(baseRequest, tx, { ...receipt, logs: [] }))
  assert.throws(() => assertPaymentEvidence(baseRequest, tx, { ...receipt, logs: [{ ...receipt.logs[0], removed: true }] }))
})

test('native ETH requires exact recipient, amount, and no contract calldata', () => {
  const { tx, receipt } = usdcEvidence()
  const pending = { ...baseRequest, version: 3, payment: { asset: 'ETH', amountRaw: '1000000000000000', quoteId: 'quote' } }
  const ethTx = { ...tx, to: recipient, value: 10n ** 15n, input: '0x' }
  assert.doesNotThrow(() => assertPaymentEvidence(pending, ethTx, receipt))
  for (const change of [{ to: wallet }, { value: 1n }, { input: '0x1234' }]) {
    assert.throws(() => assertPaymentEvidence(pending, { ...ethTx, ...change }, receipt))
  }
})

test('confirmation returns the validated replacement hash, not the dropped original', async () => {
  const { tx, receipt } = usdcEvidence()
  rpc.getChainId = async () => 42161
  rpc.waitForTransactionReceipt = async ({ hash, confirmations }) => {
    assert.equal(hash, oldHash); assert.equal(confirmations, 2); return receipt
  }
  rpc.getTransaction = async ({ hash }) => { assert.equal(hash, replacementHash); return tx }
  assert.equal(await confirmPayment(baseRequest), replacementHash)
})

test('wrong network and canonical reverts stop before a request signature', async () => {
  rpc.getChainId = async () => 1
  await assert.rejects(confirmPayment(baseRequest), /wrong network/)
  rpc.getChainId = async () => 42161
  rpc.waitForTransactionReceipt = async () => ({ status: 'reverted' })
  await assert.rejects(confirmPayment(baseRequest), PaymentRevertedError)
})

test('a replacement hash is retained even if its evidence RPC subsequently fails', async () => {
  const { receipt } = usdcEvidence()
  rpc.getChainId = async () => 42161
  rpc.waitForTransactionReceipt = async () => receipt
  rpc.getTransaction = async () => { throw new Error('RPC unavailable') }
  const remembered = []
  await assert.rejects(confirmPayment(baseRequest, hash => remembered.push(hash)), /RPC unavailable/)
  assert.deepEqual(remembered, [replacementHash])
})

test('payment config rejects wrong types, stale oracle data, and an inconsistent ETH amount', async () => {
  const valid = { ...REQUEST_PAYMENT, enabled: true, recipient, ethAvailable: true,
    ethUsdRaw: '200000000000', ethAmountRaw: '1000000000000000', ethPriceUpdatedAt: Date.now() }
  api.request = async () => valid
  assert.deepEqual(await loadPaymentConfig(), valid)
  for (const change of [null, { ethAvailable: 'true' }, { ethUsdRaw: 200000000000 },
    { ethAmountRaw: '999999999999999999' }, { ethPriceUpdatedAt: Date.now() - 4_000_000 },
    { chainId: 1 }, { recipient: address('0') }]) {
    api.request = async () => change === null ? null : { ...valid, ...change }
    await assert.rejects(loadPaymentConfig(), /invalid|does not match/)
  }
})

test('fee quotes bind asset, account, exact USDC amount and finite expiry', async () => {
  const valid = { id: '11111111-1111-4111-8111-111111111111', wallet, recipient,
    asset: 'USDC', amountRaw: '2000000', expiresAt: new Date(Date.now() + 60_000).toISOString() }
  api.request = async () => valid
  assert.deepEqual(await quoteRequestPayment(wallet, 'USDC'), valid)
  for (const change of [{ wallet: recipient }, { amountRaw: '1' }, { expiresAt: 'invalid' }, { asset: 'ETH' }]) {
    api.request = async () => ({ ...valid, ...change })
    await assert.rejects(quoteRequestPayment(wallet, 'USDC'), /Invalid payment quote/)
  }
  await assert.rejects(payRequest(wallet, recipient, { ...valid, wallet: address('3') }), /quote expired or changed/)
})

test('fees require native gas and reject partial balance failures without writing', async () => {
  rpc.readContract = async () => 2_000_000n
  rpc.getBalance = async () => 0n
  await assert.rejects(payRequest(wallet, recipient), /Keep ETH available/)
  rpc.getBalance = async () => { throw new Error('RPC unavailable') }
  await assert.rejects(payRequest(wallet, recipient), /balance unavailable/)
})

const offer = { chainId: 4663, pool: address('3'),
  token0: { address: address('4'), symbol: 'CASHCAT', decimals: 18 },
  token1: { address: address('5'), symbol: 'USDG', decimals: 6 } }

/** Price fixtures never contact the network, including reversed 6/18 pools. */
function priceFixture({ reversed = false, overrides = {} } = {}) {
  rpc.getBlockNumber = async () => 99n
  rpc.readContract = async ({ functionName, blockNumber }) => {
    assert.equal(blockNumber, 99n)
    if (functionName === 'slot0') return [2n ** 96n]
    return offer[functionName === 'token0' ? (reversed ? 'token1' : 'token0') : (reversed ? 'token0' : 'token1')].address
  }
  globalThis.fetch = async url => {
    assert.equal(url, '/fixture/prices/USDG')
    return { ok: true, json: async () => ({ success: true, data: {
      chainId: 4663, tokenAddress: offer.token1.address, currency: 'usd', price: 1,
      timestamp: new Date().toISOString(), ...overrides,
    } }) }
  }
}

test('direct prices use chain/token identity, both token orientations and decimals', async () => {
  for (const reversed of [false, true]) {
    priceFixture({ reversed })
    // A square-root ratio of 1 is 10^12 quote/base after 18/6 unit conversion.
    const price = await readOfferPrice(offer, new AbortController().signal)
    assert.equal(price.quotePerToken, 10 ** 12)
    assert.equal(price.quoteUsd, 1)
    assert.equal(price.block, '99')
  }
  priceFixture({ reversed: true })
  const originalRead = rpc.readContract
  rpc.readContract = async args => args.functionName === 'slot0' ? [2n ** 97n] : originalRead(args)
  assert.equal((await readOfferPrice(offer, new AbortController().signal)).quotePerToken, 2.5 * 10 ** 11)
})

test('prices reject wrong chains, wrong tokens, stale timestamps and unknown pool pairs', async () => {
  for (const overrides of [{ chainId: 1 }, { tokenAddress: address('6') },
    { timestamp: new Date(Date.now() - 360_000).toISOString() }, { price: 0 }]) {
    priceFixture({ overrides })
    await assert.rejects(readOfferPrice(offer, new AbortController().signal), /unavailable or stale/)
  }
  priceFixture()
  const originalRead = rpc.readContract
  rpc.readContract = async args => args.functionName === 'token0' ? address('6') : originalRead(args)
  await assert.rejects(readOfferPrice(offer, new AbortController().signal), /identity changed/)
})

test('unavailable or malformed recovery storage is not treated as a valid receipt', () => {
  globalThis.localStorage = { getItem() { throw new Error('Storage blocked') } }
  assert.equal(readPendingRequest(), null)
  globalThis.localStorage = { getItem: () => JSON.stringify({ ...baseRequest, kind: 'incentive', version: 3 }) }
  assert.equal(readPendingRequest(), null)
})

test('retired v3 and legacy v2 receipts round-trip their original paid terms unchanged', () => {
  const details = requestDraft(OFFERS[0], '10', {
    quoteUsd: 2000, quotePerToken: 0.0001, observedAt: '2026-09-06T00:00:00.000Z', block: '1',
  })
  const receipt = { ...details, ...baseRequest,
    payment: { asset: 'ETH', amountRaw: '1000000000000000', quoteId: '11111111-1111-4111-8111-111111111111' } }
  receipt.incentive.id = 'retired-offer'
  globalThis.localStorage = { getItem: () => JSON.stringify(receipt) }
  assert.deepEqual(readPendingRequest(), receipt)
  delete receipt.version
  delete receipt.payment
  delete receipt.incentive.feeTier
  receipt.incentive.slippageBps = 50
  assert.deepEqual(readPendingRequest(), receipt)
})
