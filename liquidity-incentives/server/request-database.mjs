import pg from 'pg'
import { readFile } from 'node:fs/promises'
import { randomInt } from 'node:crypto'
import { createProgramDatabase } from './program-database.mjs'
import { depositCents } from '../shared/vault-sizing.mjs'
import { createLifecycleDatabase } from './lifecycle-database.mjs'

export const USD_TOKEN_ADDRESS = '0x0000000000000000000000000000000000555344'
const schema = await readFile(new URL('./pending-vaults.sql', import.meta.url), 'utf8')
const programSchema = await readFile(new URL('./incentive-programs.sql', import.meta.url), 'utf8')
const sizingSchema = await readFile(new URL('./vault-sizing.sql', import.meta.url), 'utf8')
const lifecycleSchema = await readFile(new URL('./vault-lifecycle.sql', import.meta.url), 'utf8')

/** Public IDs follow fixed-income's 12 uppercase alphanumeric convention. */
function requestId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  return Array.from({ length: 12 }, () => alphabet[randomInt(alphabet.length)]).join('')
}

/** One fixed-side depositor funds one vault, sized to the selected USD deposit. */
export function toPendingVault(record, feeTier) {
  const t = record.incentive
  if (record.kind !== 'incentive' || !t) return null
  if (![100, 500, 3000, 10000].includes(feeTier)) throw new Error('Pool fee is unavailable')
  return {
    chain_id: t.chainId, submitter_address: record.wallet.toLowerCase(),
    token0_address: t.token0.address.toLowerCase(), token1_address: t.token1.address.toLowerCase(),
    pool_address: t.poolAddress.toLowerCase(), fee_tier: feeTier, adapter_type: 'fullRange',
    min_tick: null, max_tick: null, duration_seconds: String(t.durationDays * 86400),
    fixed_capacity_token_address: USD_TOKEN_ADDRESS,
    // Legacy sub-cent receipts remain recoverable but require manual sizing.
    fixed_capacity_amount: depositCents(t.depositUsd),
    variable_asset_address: t.token0.address.toLowerCase(), variable_asset_amount: null,
    use_target_apr: true, target_apr: t.aprPercent / 100, is_advanced_mode: false,
    notes: `LiqiFi incentive ${t.id}. Intended deposit: ${t.depositUsd} USD. Full quote retained with payment evidence.`,
    created_at: record.createdAt, updated_at: record.createdAt,
  }
}

/** Match fixed-income's camelCase API projection; private fields are opt-in. */
export function publicPending(row, admin = false) {
  const value = {
    requestId: row.request_id, chainId: row.chain_id, submitterAddress: row.submitter_address,
    status: row.status, token0Address: row.token0_address, token1Address: row.token1_address,
    poolAddress: row.pool_address, feeTier: row.fee_tier, adapterType: row.adapter_type,
    minTick: row.min_tick, maxTick: row.max_tick, durationSeconds: Number(row.duration_seconds),
    fixedCapacityTokenAddress: row.fixed_capacity_token_address, fixedCapacityAmount: row.fixed_capacity_amount,
    variableAssetAddress: row.variable_asset_address, variableAssetAmount: row.variable_asset_amount,
    useTargetApr: row.use_target_apr, targetApr: row.target_apr === null ? null : Number(row.target_apr),
    isAdvancedMode: row.is_advanced_mode, notes: row.notes, rejectionReason: row.rejection_reason,
    reviewedAt: row.reviewed_at ? Math.floor(new Date(row.reviewed_at).getTime() / 1000) : null,
    createdVaultAddress: row.created_vault_address,
    createdAt: Math.floor(new Date(row.created_at).getTime() / 1000), updatedAt: Math.floor(new Date(row.updated_at).getTime() / 1000),
  }
  if (admin) Object.assign(value, { adminNotes: row.admin_notes, reviewedBy: row.reviewed_by,
    submitterTelegram: row.submitter_telegram, submitterDiscord: row.submitter_discord })
  return value
}

/**
 * Dedicated PostgreSQL persistence. Hosted connections use Unix peer auth,
 * not a password. Tests inject a separate real PostgreSQL database/pool.
 * Schema install and legacy import finish before fees become available.
 */
export function createRequestDatabase({ connection = {}, pool: injectedPool, legacyPath, resolvePoolFee,
  schemaMode = 'standalone', retryDelayMs = 5000, now = Date.now } = {}) {
  if (!['standalone', 'fixed-income'].includes(schemaMode)) throw new Error('Invalid request database schema mode.')
  const pool = injectedPool ?? new pg.Pool({ host: process.env.SAFFRON_DB_HOST || '/var/run/postgresql',
    user: process.env.SAFFRON_DB_USER || 'saffron_incentives', database: process.env.SAFFRON_DB_NAME || 'saffron_incentives',
    max: 4, connectionTimeoutMillis: 5000, options: '-c timezone=UTC', ...connection })
  // No raw errors are logged: a connection string or data value must not leak.
  pool.on('error', () => {})

  /** One transaction covers the compatible row and its unique payment sidecar. */
  async function saveNow(record) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [record.paymentTxHash.toLowerCase()])
      const existing = (await client.query('SELECT * FROM liqifi.request_payments WHERE payment_tx_hash=$1', [record.paymentTxHash.toLowerCase()])).rows[0]
      if (existing) {
        if (existing.request_digest !== record.requestDigest) {
          const error = new Error('This payment already belongs to a different request.'); error.status = 409; throw error
        }
        await client.query('COMMIT')
        return { record: { ...existing.payload, id: existing.pending_request_id ?? existing.legacy_id }, created: false }
      }
      // Resolve legacy pool metadata only on the first import. A later RPC
      // outage must not block restarting an already-migrated durable database.
      const feeTier = record.incentive ? record.incentive.feeTier
        ?? await resolvePoolFee?.(record.chain, record.incentive.poolAddress) : null
      const pending = toPendingVault(record, feeTier)
      let id = null
      if (pending) {
        id = requestId()
        const row = { request_id: id, ...pending }
        const columns = Object.keys(row)
        await client.query(`INSERT INTO uniswap_v3_fiv.pending_vaults (${columns.join(',')}) VALUES (${columns.map((_, i) => '$' + (i + 1)).join(',')})`, Object.values(row))
      }
      await client.query(`INSERT INTO liqifi.request_payments
        (payment_tx_hash,pending_request_id,legacy_id,request_digest,submitter_address,created_at,payload,sizing_version)
        VALUES ($1,$2,$3,$4,$5,$6,$7,2)`, [record.paymentTxHash.toLowerCase(), id, record.id, record.requestDigest,
        record.wallet.toLowerCase(), record.createdAt, record])
      await client.query('COMMIT')
      return { record: { ...record, id: id ?? record.id }, created: true }
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
  }

  async function initialize() {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock(1966090601)')
      if (schemaMode === 'standalone') await client.query(schema)
      else {
        // The FI migration runner owns this table and its triggers in shared mode.
        // Fail closed if the canonical queue has not been installed first.
        await client.query('SELECT request_id,created_vault_address,rejection_reason,variable_asset_amount FROM uniswap_v3_fiv.pending_vaults LIMIT 0')
        await client.query('CREATE SCHEMA IF NOT EXISTS liqifi')
        await client.query(schema.slice(schema.indexOf('-- Sidecar:')))
      }
      await client.query(programSchema)
      await client.query(sizingSchema)
      await client.query(lifecycleSchema)
      await client.query('COMMIT')
    } catch (error) { await client.query('ROLLBACK'); throw error }
    finally { client.release() }
    if (legacyPath) {
      let records
      try { records = JSON.parse(await readFile(legacyPath, 'utf8')) }
      catch (error) { if (error.code === 'ENOENT') return; throw error }
      if (!Array.isArray(records)) throw new Error('Invalid legacy queue')
      for (const record of records) await saveNow(record)
      // The original file remains untouched as an independently recoverable archive.
    }
  }

  // Share one initialization attempt across readers. A failed startup can retry
  // on a later request without a process restart or an unbounded retry loop.
  // Schema installation and the entire legacy import must succeed first.
  let initialization, failed = false, retryAt = 0, closed = false
  function ensureReady() {
    if (closed) return Promise.reject(new Error('Request database is closed.'))
    if (!initialization || (failed && now() >= retryAt)) {
      failed = false
      initialization = initialize()
      initialization.catch(() => { failed = true; retryAt = now() + retryDelayMs })
    }
    return initialization
  }
  ensureReady()

  const database = {
    ...createProgramDatabase(pool, ensureReady),
    get ready() { return ensureReady() },
    pool,
    async close() { closed = true; await initialization.catch(() => {}); await pool.end() },
    async health() { await ensureReady(); await pool.query('SELECT 1') },
    async save(record) { await ensureReady(); return saveNow(record) },
    async putQuote(quote) {
      await ensureReady()
      await pool.query(`INSERT INTO liqifi.request_fee_quotes (id,wallet,recipient,asset,amount_raw,eth_usd_raw,expires_at,request_details)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [quote.id, quote.wallet, quote.recipient, quote.asset, quote.amountRaw, quote.ethUsdRaw ?? null, quote.expiresAt, quote.details ?? null])
    },
    async getQuote(id) {
      await ensureReady()
      return (await pool.query('SELECT * FROM liqifi.request_fee_quotes WHERE id=$1', [id])).rows[0] ?? null
    },
    async list({ wallet, chainId, requestId, admin = false }, executor = pool) {
      await ensureReady()
      const rows = (await executor.query(`SELECT pv.*, rp.payload FROM uniswap_v3_fiv.pending_vaults pv
        JOIN liqifi.request_payments rp ON rp.pending_request_id=pv.request_id
        WHERE ($1::text IS NULL OR pv.submitter_address=$1) AND ($2::integer IS NULL OR pv.chain_id=$2)
        AND ($3::text IS NULL OR pv.request_id=$3)
        ORDER BY pv.created_at DESC`, [wallet?.toLowerCase() ?? null, chainId ?? null, requestId ?? null])).rows
      return rows.map((row) => ({ ...publicPending(row, admin),
        // Public-grade display metadata only; never spread the complete receipt.
        display: { pair: row.payload.pair, depositUsd: row.payload.incentive?.depositUsd,
          paymentTxHash: row.payload.paymentTxHash, paymentAsset: row.payload.paymentAsset ?? 'USDC',
          paymentAmount: row.payload.paymentAmount, legacyId: row.payload.id } }))
    },
    async inquiries(wallet) {
      await ensureReady()
      const rows = (await pool.query(`SELECT legacy_id,created_at,payload FROM liqifi.request_payments
        WHERE pending_request_id IS NULL AND submitter_address=$1 ORDER BY created_at DESC LIMIT 200`, [wallet.toLowerCase()])).rows
      return rows.map((row) => ({ requestId: row.legacy_id, status: 'pending', createdAt: row.created_at,
        pair: row.payload.pair, depositToken: row.payload.depositToken, depositAmount: row.payload.depositAmount }))
    },
  }
  database.lifecycle = createLifecycleDatabase(pool, ensureReady, (options, executor) => database.list(options, executor))
  return database
}
