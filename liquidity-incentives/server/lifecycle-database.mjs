import { creationTerms, termsDigest, FACTORY, CHAIN_ID, sameAddress } from '../shared/vault-lifecycle.mjs'
import { depositCents } from '../shared/vault-sizing.mjs'

const fail = (status, message) => Object.assign(new Error(message), { status })

/** Persistence shared by HTTP, the read-only observer, and the isolated signer.
 * Only explicit DTOs leave this module; signed transaction bytes stay private.
 */
export function createLifecycleDatabase(pool, ready, requestList) {
  const query = async (sql, values = []) => { await ready(); return pool.query(sql, values) }
  const job = async id => (await query('SELECT * FROM liqifi.vault_creation_jobs WHERE request_id=$1', [id])).rows[0] ?? null
  return {
    job,
    async approveCreation({ requestId, expectedDigest, operator, signer, resume = false, sizingReview }) {
      await ready()
      const client = await pool.connect()
      try { await client.query('BEGIN')
        await client.query('SELECT request_id FROM uniswap_v3_fiv.pending_vaults WHERE request_id=$1 FOR UPDATE', [requestId])
        const [row] = await requestList({ requestId }, client)
        if (!row || row.chainId !== CHAIN_ID) throw fail(404, 'Request not found.')
        const digest = termsDigest(row)
        if (digest !== expectedDigest) throw fail(409, 'Request terms changed. Reload before approving.')
        const existing = (await client.query('SELECT * FROM liqifi.vault_creation_jobs WHERE request_id=$1', [requestId])).rows[0]
        if (existing) {
          if (existing.approved_digest !== digest) throw fail(409, 'Approved terms differ. Operator review required.')
          if (resume && (existing.state === 'failed' || existing.funding_state === 'failed')) {
            await client.query("UPDATE liqifi.vault_creation_jobs SET state=CASE WHEN state='failed' THEN 'queued' ELSE state END, funding_state=CASE WHEN funding_state='failed' THEN 'queued' ELSE funding_state END,resume_version=resume_version+1,error=NULL,updated_at=NOW() WHERE request_id=$1", [requestId])
          }
          await client.query('COMMIT'); return (await client.query('SELECT * FROM liqifi.vault_creation_jobs WHERE request_id=$1', [requestId])).rows[0]
        }
        if (row.status !== 'pending' || row.createdVaultAddress) throw fail(409, 'This request cannot be created again.')
        const cents = depositCents(row.display.depositUsd)
        if (row.adapterType !== 'fullRange' || row.useTargetApr !== true || !Number.isFinite(row.targetApr) || row.targetApr <= 0) throw fail(409, 'Only full-range requests are supported by this deployer.')
        const requiresSizingReview = !cents || cents !== row.fixedCapacityAmount
        if (requiresSizingReview && (!sizingReview || !/^[1-9][0-9]{0,14}$/.test(sizingReview.cents) || typeof sizingReview.reason !== 'string' || sizingReview.reason.trim().length < 10 || sizingReview.reason.length > 500)) {
          throw fail(409, 'Request requires an explicit approved USD-cent sizing snapshot and review reason. Its receipt is unchanged.')
        }
        const evidence = (await client.query('SELECT request_digest,payload FROM liqifi.request_payments WHERE pending_request_id=$1', [requestId])).rows[0]
        if (!evidence?.payload?.incentive) throw fail(409, 'Original payment evidence is required.')
        const snapshot = { ...creationTerms(row), display: row.display, token0: evidence.payload.incentive.token0, token1: evidence.payload.incentive.token1, ...(requiresSizingReview ? { fixedCapacityAmount: sizingReview.cents, sizingReview: { ...sizingReview, operator: operator.toLowerCase(), originalCents: row.fixedCapacityAmount, approvedAt: new Date().toISOString() } } : {}) }
        await client.query('INSERT INTO liqifi.vault_creation_jobs (request_id,chain_id,factory,operator,signer,approved_digest,receipt_digest,snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [requestId, CHAIN_ID, FACTORY, operator.toLowerCase(), signer.toLowerCase(), digest, evidence.request_digest, snapshot])
        await client.query('UPDATE uniswap_v3_fiv.pending_vaults SET reviewed_by=$2,reviewed_at=NOW() WHERE request_id=$1', [requestId, operator.toLowerCase()])
        await client.query('COMMIT'); return (await client.query('SELECT * FROM liqifi.vault_creation_jobs WHERE request_id=$1', [requestId])).rows[0]
      } catch (error) { await client.query('ROLLBACK'); throw error }
      finally { client.release() }
    },
    async approveFunding(id, operator, digest, maximum) {
      const current = await job(id)
      if (!current || current.state !== 'created' || current.approved_digest !== digest || !current.plan
        || maximum !== current.plan.premium) throw fail(409, 'Reload the created vault and its exact premium before funding.')
      await query("UPDATE liqifi.vault_creation_jobs SET funding_state='queued',funding_operator=$2,funding_max_raw=$3,resume_version=resume_version+1,error=NULL,updated_at=NOW() WHERE request_id=$1 AND funding_state IN ('unapproved','failed','funded')", [id, operator.toLowerCase(), maximum])
      return job(id)
    },
    async summary(id, admin = false) {
      const [current, observed] = await Promise.all([job(id), query('SELECT snapshot FROM liqifi.vault_readiness WHERE request_id=$1', [id])])
      if (!current) return { job: null, observation: null }
      const txs = (await query('SELECT step,hash,receipt FROM liqifi.vault_creation_transactions WHERE request_id=$1 ORDER BY id', [id])).rows
      return {
        job: { state: current.state, fundingState: current.funding_state, termsDigest: current.approved_digest,
          error: current.error, plan: current.plan, ...(admin ? { signer: current.signer, operator: current.operator } : {}),
          transactions: txs.map(tx => ({ step: tx.step, hash: tx.hash, status: tx.receipt?.status === '0x1' ? 'Confirmed' : tx.receipt?.status === '0x0' ? 'Reverted' : 'Pending' })) },
        observation: observed.rows[0]?.snapshot ?? null,
      }
    },
    async saveObservation(id, snapshot) {
      await query('INSERT INTO liqifi.vault_readiness (request_id,snapshot) VALUES ($1,$2) ON CONFLICT(request_id) DO UPDATE SET snapshot=EXCLUDED.snapshot,updated_at=NOW()', [id, snapshot])
    },
    async tracked() {
      return (await query("SELECT * FROM liqifi.vault_creation_jobs WHERE state='created' ORDER BY updated_at DESC")).rows
    },
    async heartbeat(signer) {
      await query('INSERT INTO liqifi.vault_worker_heartbeats (signer) VALUES ($1) ON CONFLICT(signer) DO UPDATE SET updated_at=NOW()', [signer.toLowerCase()])
    },
    async workerOnline(signer) {
      if (!signer) return false
      return Boolean((await query("SELECT signer FROM liqifi.vault_worker_heartbeats WHERE signer=$1 AND updated_at>NOW()-INTERVAL '15 seconds'", [signer.toLowerCase()])).rowCount)
    },
    /** Hold a PostgreSQL session lock for one signer across nonce allocation/broadcast. */
    async signerLock(signer) {
      await ready()
      const client = await pool.connect()
      const lock = (await client.query("SELECT pg_try_advisory_lock(hashtextextended('saffron-signer:' || $1,0)) AS locked", [signer.toLowerCase()])).rows[0].locked
      if (!lock) { client.release(); return null }
      let alive = true
      const lost = () => { alive = false }
      client.on('error', lost)
      return { assert: async () => { if (!alive) throw new Error('Signer lock lost'); await client.query('SELECT 1') },
        release: async () => { client.off('error', lost); try { if (alive) await client.query("SELECT pg_advisory_unlock(hashtextextended('saffron-signer:' || $1,0))", [signer.toLowerCase()]) } finally { client.release() } } }
    },
    async claim(signer, owner) {
      return (await query("UPDATE liqifi.vault_creation_jobs SET lease_owner=$2,lease_until=NOW()+INTERVAL '60 seconds', state=CASE WHEN state='created' THEN state ELSE 'running' END, funding_state=CASE WHEN state='created' THEN 'running' ELSE funding_state END, updated_at=NOW() WHERE request_id=(SELECT request_id FROM liqifi.vault_creation_jobs WHERE signer=$1 AND (state IN ('queued','running','waiting') OR (state='created' AND funding_state IN ('queued','running','waiting'))) AND (lease_until IS NULL OR lease_until<NOW() OR lease_owner=$2) ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *", [signer.toLowerCase(), owner])).rows[0] ?? null
    },
    async renew(id, owner) {
      const result = await query("UPDATE liqifi.vault_creation_jobs SET lease_until=NOW()+INTERVAL '60 seconds' WHERE request_id=$1 AND lease_owner=$2 AND lease_until>NOW() RETURNING request_id", [id, owner])
      if (!result.rowCount) throw new Error('Job lease lost')
    },
    async setPlan(id, owner, plan) {
      await query('UPDATE liqifi.vault_creation_jobs SET plan=$3,updated_at=NOW() WHERE request_id=$1 AND lease_owner=$2', [id, owner, plan])
    },
    async setState(id, owner, state, fundingState, error = null) {
      await query('UPDATE liqifi.vault_creation_jobs SET state=$3,funding_state=$4,error=$5,lease_until=NULL,lease_owner=NULL,updated_at=NOW() WHERE request_id=$1 AND lease_owner=$2', [id, owner, state, fundingState, error])
    },
    async lastTransaction(id, step) {
      return (await query('SELECT * FROM liqifi.vault_creation_transactions WHERE request_id=$1 AND step=$2 ORDER BY id DESC LIMIT 1', [id, step])).rows[0] ?? null
    },
    async saveTransaction({ requestId, step, resumeVersion, signer, nonce, hash, raw, transaction }) {
      await query('INSERT INTO liqifi.vault_creation_transactions (request_id,step,resume_version,signer,nonce,hash,raw_tx,transaction_data) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [requestId, step, resumeVersion, signer.toLowerCase(), String(nonce), hash, raw, transaction])
    },
    async saveReceipt(hash, receipt) { await query('UPDATE liqifi.vault_creation_transactions SET receipt=$2 WHERE hash=$1', [hash, receipt]) },
    async markCreated(id, owner, snapshot) {
      const current = await job(id)
      if (!current?.plan || !snapshot.verified || !snapshot.initialized || !sameAddress(snapshot.vault, current.plan.vault)) throw new Error('Creation verification failed')
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        await client.query('SELECT request_id FROM uniswap_v3_fiv.pending_vaults WHERE request_id=$1 FOR UPDATE', [id])
        const [row] = await requestList({ requestId: id }, client)
        if (!row || row.status !== 'pending' || termsDigest(row) !== current.approved_digest) throw new Error('Approved request changed')
        const updated = await client.query("UPDATE liqifi.vault_creation_jobs SET state='created',lease_owner=NULL,lease_until=NULL,error=NULL,updated_at=NOW() WHERE request_id=$1 AND lease_owner=$2 RETURNING request_id", [id, owner])
        if (!updated.rowCount) throw new Error('Job lease lost')
        await client.query("UPDATE uniswap_v3_fiv.pending_vaults SET status='created',created_vault_address=$2,updated_at=NOW() WHERE request_id=$1", [id, snapshot.vault.toLowerCase()])
        await client.query('COMMIT')
      } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
      await this.saveObservation(id, snapshot)
    },
  }
}
