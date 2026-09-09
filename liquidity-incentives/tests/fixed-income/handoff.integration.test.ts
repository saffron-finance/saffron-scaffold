import express from 'express'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keccak256, stringToHex } from 'viem'
import { API_ENDPOINTS, TABLES, getTableName, buildCompleteVaultRequestSigningMessage,
  decodeAdminCreateVaultUrlParams } from '@packages/api-types'
import { postgresFixture } from '../postgres-fixture.mjs'
import { createFixedIncomeHandoff } from '../../server/fixed-income-handoff.mjs'

const context = vi.hoisted(() => ({ pool: null as any, owner: '', token0: '', token1: '' }))
const logger = vi.hoisted(() => ({ info() {}, warn() {}, error() {}, debug() {} }))
// Inject only the disposable PG connection, logging, notification transport,
// and chain reads. FI's route, signatures, DB service, projection and URL
// decoder run unchanged from the selected checkout.
vi.mock('@fi/dbPool', () => ({ getDbPool: () => context.pool }))
vi.mock('@fi/lib', () => ({ createLogger: () => logger }))
vi.mock('@packages/core', async () => {
  const { PendingVaultsDbService } = await import('@fi/db')
  return { createLogger: () => logger, pendingVaultsDb: new PendingVaultsDbService(),
    resolveFeatureFlagBool: () => false, getFrontendBaseUrl: () => 'http://localhost:3000' }
})
vi.mock('@fi/bots', () => ({ adminTelegramBot: null }))
vi.mock('@fi/tokenProvider', () => ({ TokenProvider: {} }))
vi.mock('@fi/providers', async () => ({
  PendingVaultProvider: (await import('@fi/provider')).PendingVaultProvider,
  VaultFactoryProvider: { getFactoryInfo: async () => ({ owner: context.owner }) },
  VaultProvider: { fetchAllVaultDataFromChain: async () => ({ adapterAddress: '0x' + '44'.repeat(20) }) },
  UniV3AdapterProvider: { getStaticData: async () => ({ token0: context.token0, token1: context.token1 }) },
  BetaWhitelistProvider: {}, BetaWhitelistRequestProvider: {}, WhitelistProvider: {},
}))
// These routes do not use the JWT middleware: my-submissions is public and
// complete verifies an action-specific owner signature inside the real route.
// Fail if the scenario unexpectedly takes another authentication path.
vi.mock('@fi/walletAuth', () => ({ walletAuth: () => { throw new Error('Unexpected JWT route') },
  requireMatchingWallet: () => () => { throw new Error('Unexpected JWT route') } }))
vi.mock('@fi/walletAdminAuth', () => ({ walletAdminAuth: () => { throw new Error('Unexpected admin JWT route') } }))

import router from '@fi/route'
import { PendingVaultProvider } from '@fi/provider'

it('scaffold request → actual FI queue and owner completion → fixed/variable entries', async () => {
  const store = await postgresFixture()
  context.pool = store.database.pool
  let server
  try {
    const owner = privateKeyToAccount(generatePrivateKey()), depositor = privateKeyToAccount(generatePrivateKey())
    context.owner = owner.address
    context.token0 = '0x' + '22'.repeat(20); context.token1 = '0x' + '33'.repeat(20)
    // The actual FI SELECT joins its own whitelist table. Use its authoritative
    // table identifier; only the contact columns needed for this local fixture.
    await context.pool.query(`CREATE SCHEMA ${TABLES.BETA_WHITELIST.schema}`)
    await context.pool.query(`CREATE TABLE ${getTableName(TABLES.BETA_WHITELIST)} (wallet_address text PRIMARY KEY, telegram text, discord text)`)
    const saved = await store.database.save({ kind: 'incentive', id: 'fixture-paid-request', wallet: depositor.address,
      createdAt: new Date().toISOString(), paymentTxHash: '0x' + '12'.repeat(32), requestDigest: keccak256(stringToHex('fixture-paid-request')),
      pair: 'AAA / BBB', paymentAmount: '2', paymentAsset: 'USDC',
      incentive: { id: 'program', chainId: 4663, poolAddress: '0x' + '55'.repeat(20), feeTier: 10000,
        token0: { address: context.token0 }, token1: { address: context.token1 }, durationDays: 3,
        depositUsd: '1000.29', capacityUsd: 100000, aprPercent: 1000 } })
    const app = express(); app.use(express.json()); app.use(router)
    server = app.listen(0, '127.0.0.1')
    await new Promise<void>(resolve => server.once('listening', resolve))
    const origin = `http://127.0.0.1:${(server.address() as any).port}`
    const fiRequest = await PendingVaultProvider.getByRequestId(saved.record.id)
    expect(fiRequest.fixedCapacityAmount).toBe('100029')
    expect(fiRequest.targetApr).toBe(10); expect(fiRequest.variableAssetAmount).toBeUndefined()
    const handoff = createFixedIncomeHandoff({ frontendUrl: 'http://localhost:3000/app', apiUrl: origin })
    const [row] = await store.database.list({ wallet: depositor.address })
    const creation = new URL(await handoff(row, 'create'))
    const params = decodeAdminCreateVaultUrlParams(creation.searchParams)
    expect(params.requestId).toBe(saved.record.id); expect(params.fixedCapacityUsd).toBe(1000.29)
    expect(params.targetApr).toBe(10); expect(params.days).toBe(3)
    const vaultAddress = '0x' + '66'.repeat(20)
    const completePath = API_ENDPOINTS.pendingVault.complete.replace(':chainId','4663').replace(':requestId',saved.record.id)
    const complete = async (signer: typeof owner) => {
      const signature = await signer.signMessage({ message: buildCompleteVaultRequestSigningMessage(signer.address, 4663, saved.record.id, vaultAddress) })
      return fetch(origin + completePath, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ signerAddress: signer.address, vaultAddress, signature }) })
    }
    expect((await complete(depositor)).status).toBe(403)
    const response = await complete(owner)
    expect(response.status, JSON.stringify(await response.json())).toBe(200)
    const [created] = await store.database.list({ wallet: depositor.address })
    expect(created.requestId).toBe(saved.record.id); expect(created.status).toBe('created')
    expect(created.createdVaultAddress).toBe(vaultAddress)
    for (const side of ['fixed','variable']) expect(await handoff(created, side)).toBe(
      `http://localhost:3000/app/network/robinhood/vault/${vaultAddress}/${side}`)
    expect((await store.records()).length).toBe(1)
    expect((await context.pool.query('SELECT count(*) FROM uniswap_v3_fiv.pending_vaults')).rows[0].count).toBe('1')
  } finally {
    if (server) await new Promise<void>(resolve => server.close(() => resolve()))
    context.pool = null; await store.close()
  }
})
