import { expect } from '@playwright/test'
import { createServer } from 'node:http'
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { hexToString, encodeAbiParameters } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createVaultRequestHandler } from '../../server/vault-requests.mjs'
import { HASH, RECIPIENT, paymentFixture } from '../payment-fixture.mjs'
import { postgresFixture } from '../postgres-fixture.mjs'
import { feeRpc } from '../fee-fixture.mjs'
import { createIncentiveProgramHandler } from '../../server/incentive-programs.mjs'
import { catalogRpc } from '../catalog-fixture.mjs'
import { createFixedIncomeHandoff } from '../../server/fixed-income-handoff.mjs'

const BASE = ''

/**
 * Use real EIP-6963 discovery, viem calldata/signatures, HTTP verification, and
 * queue writes, with only the wallet/RPC replaced by unfunded local fixtures.
 * The default injected provider is MetaMask; Uniswap must be selected explicitly.
 */
export async function setup(page, options = {}) {
  const account = privateKeyToAccount(generatePrivateKey())
  const directory = await mkdtemp(join(tmpdir(), 'liqifi-browser-'))
  const storePath = join(directory, 'queue.json')
  const state = { chain: '0x1', sends: 0, signs: 0, saved: 0, calls: [], messages: [], receipt: null,
    rejectPayment: false, rejectSignature: false, lostSave: false, usdcBalance: 100_000_000n, ethBalance: 10_000_000_000_000_000n, ...options }
  const fixture = paymentFixture(account.address)
  if (options.reverted) fixture.receipt.status = '0x0'
  const storage = await postgresFixture({ resolvePoolFee: options.resolvePoolFee })
  const oracleRpc = feeRpc(fixture, options)
  let handoff
  const handler = createVaultRequestHandler({ recipient: options.enabled === false ? null : RECIPIENT,
    storePath, database: storage.database, adminOwner: async () => options.notAdmin ? RECIPIENT : account.address, basePath: BASE, rpc: (...args) => oracleRpc(...args),
    handoff: options.handoff ? (...args) => handoff(...args) : undefined })
  const programs = createIncentiveProgramHandler({ database: storage.database,
    adminOwner: async () => options.notAdmin ? RECIPIENT : account.address, basePath: BASE, rpc: catalogRpc() })
  const server = createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname
    // Only the external FI read boundary is replaced here. Database writes,
    // handoff validation and signatures are real. The optional FI integration
    // suite exercises its actual route/provider against this same schema.
    if (options.handoff && pathname.startsWith('/api/v1/pending-vaults/4663/my-submissions/')) {
      state.handoffReads = (state.handoffReads ?? 0) + 1
      const data = state.handoffMissing ? [] : await storage.database.list({ wallet: pathname.split('/').at(-1) })
      res.writeHead(state.handoffOffline ? 503 : 200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ success: !state.handoffOffline, data })); return
    }
    if (!await handler(req, res, pathname) && !await programs(req, res, pathname)) { res.writeHead(404); res.end() }
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const api = `http://127.0.0.1:${server.address().port}`
  if (options.handoff) handoff = createFixedIncomeHandoff({ apiUrl: api, frontendUrl: 'http://127.0.0.1:13218/fixed-income' })
  await page.route(/\/(?:vault-requests|incentive-programs)(?:\/[^?]*)?(?:\?.*)?$/,  async (route) => {
    const request = route.request()
    const response = await fetch(`${api}${new URL(request.url()).pathname}${new URL(request.url()).search}`, {
      method: request.method(), headers: { 'content-type': 'application/json' }, body: request.postData() ?? undefined,
    })
    if (request.method() === 'POST' && new URL(request.url()).pathname === `${BASE}/vault-requests`) {
      state.saved++
      if (state.lostSave) { state.lostSave = false; await route.fulfill({ status: 503, json: { error: 'Simulated lost response. Retry without paying again.' } }); return }
    }
    await route.fulfill({ status: response.status, contentType: 'application/json', body: await response.text() })
  })
  // Same token-price endpoint as the deployed page; never read live prices.
  await page.route('**/prices/*', route => {
    const symbol = new URL(route.request().url()).pathname.split('/').at(-1)
    const isEth = symbol === 'ETH' || symbol.toLowerCase() === '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
    return route.fulfill({status: state.quoteOffline ? 503 : 200, json: {success: true, data: {
      chainId: 4663, tokenAddress: isEth ? '0x0bd7d308f8e1639fab988df18a8011f41eacad73' : '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
      price: isEth ? 2000 : 1, timestamp: new Date().toISOString(), currency: 'usd',
    }}})
  })
  await page.route('**/rpc/*', async (route) => {
    const body = route.request().postDataJSON()
    const resolve = async (call) => {
      if (state.failEthBalance && call.method === 'eth_getBalance') return { jsonrpc: '2.0', id: call.id, error: { code: -32000, message: 'Fixture balance unavailable' } }
      const slot0 = call.method === 'eth_call' && call.params?.[0]?.data === '0x3850c7bd'
      const sqrtPrice = call.params?.[0]?.to?.toLowerCase() === '0x4b0c312ffbb068f6a0bea128759e35d94b94d0e1' ? (2n ** 96n) / 10_000_000n : (2n ** 96n) / 1000n
      const usdcBalance = call.method === 'eth_call' && call.params?.[0]?.to?.toLowerCase() === '0xaf88d065e77c8cc2239327c5edb3a432268e5831' && call.params?.[0]?.data?.startsWith('0x70a08231')
      const result = call.method === 'eth_getBalance' ? '0x' + state.ethBalance.toString(16)
        : usdcBalance ? '0x' + state.usdcBalance.toString(16).padStart(64, '0')
        : call.method === 'eth_call' && call.params?.[0]?.data === '0x0dfe1681' ? encodeAbiParameters([{type:'address'}], ['0x020bfC650A365f8BB26819deAAbF3E21291018b4'])
        : call.method === 'eth_call' && call.params?.[0]?.data === '0xd21220a7' ? encodeAbiParameters([{type:'address'}], [call.params[0].to.toLowerCase() === '0x4b0c312ffbb068f6a0bea128759e35d94b94d0e1' ? '0x5fc5360d0400a0fd4f2af552add042d716f1d168' : '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73'])
        : slot0 ? encodeAbiParameters([{ type: 'uint160' }, { type: 'int24' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint16' }, { type: 'uint8' }, { type: 'bool' }], [sqrtPrice, 0, 0, 0, 0, 0, true])
        : call.method === 'eth_call' ? `0x${'0'.repeat(64)}`
        : call.method === 'eth_chainId' ? ({ ethereum: '0x1', arbitrum: '0xa4b1', robinhood: '0x1237' })[new URL(route.request().url()).pathname.split('/').at(-1)]
        : await fixture.rpc(call.method, call.params)
      return { jsonrpc: '2.0', id: call.id, result }
    }
    await route.fulfill({ json: Array.isArray(body) ? await Promise.all(body.map(resolve)) : await resolve(body) })
  })
  await page.exposeFunction('fixtureWalletRequest', async (name, { method, params }) => {
    state.calls.push({ name, method })
    if (method === 'eth_chainId') return state.chain
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [account.address]
    if (method === 'wallet_switchEthereumChain') { state.chain = params[0].chainId; return null }
    if (method === 'eth_sendTransaction') {
      if (state.rejectPayment) throw new Error('User rejected payment')
      expect(name).toBe('Uniswap Extension')
      if (params[0].to.toLowerCase() === RECIPIENT.toLowerCase()) {
        expect(BigInt(params[0].value)).toBe(1_000_000_000_000_000n)
        expect(params[0].data ?? '0x').toBe('0x')
        Object.assign(fixture.tx, { to: RECIPIENT, input: '0x', value: params[0].value })
        Object.assign(fixture.receipt, { to: RECIPIENT, logs: [] })
      } else {
        expect(params[0].to.toLowerCase()).toBe(fixture.tx.to.toLowerCase())
        expect(params[0].data.toLowerCase()).toBe(fixture.tx.input.toLowerCase())
      }
      state.sends++
      if (state.holdPayment) await new Promise((resolve) => { state.releasePayment = resolve })
      return HASH
    }
    if (method === 'personal_sign') {
      state.signs++
      state.messages.push(hexToString(params[0]))
      if (state.rejectSignature) { state.rejectSignature = false; throw new Error('User rejected signature') }
      return account.signMessage({ message: hexToString(params[0]) })
    }
    // Reproduce the Uniswap receipt shape. Correct application code never
    // reaches this branch: all receipts must come from the independent RPC.
    if (method === 'eth_getTransactionReceipt') return { ...fixture.receipt, status: 1 }
    throw new Error(`Unsupported fixture wallet method ${method}`)
  })
  await page.addInitScript(() => {
    const makeProvider = (name) => {
      const listeners = new Map()
      return {
        isMetaMask: name === 'MetaMask',
        request: async (args) => {
          const result = await window.fixtureWalletRequest(name, args)
          if (args.method === 'wallet_switchEthereumChain') for (const callback of listeners.get('chainChanged') ?? []) callback(args.params[0].chainId)
          return result
        },
        on: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
        removeListener: (name, handler) => listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== handler)),
      }
    }
    const metamask = makeProvider('MetaMask')
    const uniswap = makeProvider('Uniswap Extension')
    window.ethereum = metamask
    // New UUIDs on each reload exercise stable persisted RDNS selection.
    const wallets = [
      { provider: metamask, info: { uuid: crypto.randomUUID(), rdns: 'io.metamask', name: 'MetaMask', icon: '' } },
      { provider: uniswap, info: { uuid: crypto.randomUUID(), rdns: 'org.uniswap', name: 'Uniswap Extension', icon: '' } },
    ]
    window.addEventListener('eip6963:requestProvider', () => {
      for (const detail of wallets) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
    })
  })
  return { state, storePath, chain: fixture, database: storage.database, records: storage.records, account, close: async () => { await new Promise((resolve) => server.close(resolve)); await storage.close() } }
}
