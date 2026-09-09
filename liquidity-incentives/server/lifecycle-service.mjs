import { readVault } from '../shared/vault-reader.mjs'
import { eligibility, termsDigest } from '../shared/vault-lifecycle.mjs'

/** Single-flight, read-only observer. A failed check replaces any old green badge. */
export function createLifecycleService({ database, rpc, signer, confirmations = 2, now = Date.now }) {
  const pending = new Map()
  let running = false
  async function refresh(id) {
    if (pending.has(id)) return pending.get(id)
    const operation = (async () => {
      const job = await database.lifecycle.job(id)
      if (!job?.plan?.vault || job.state !== 'created') return null
      let snapshot
      try { snapshot = await readVault(job, rpc, { confirmations, now }) }
      catch { snapshot = { verified: false, checkedAt: now(), reason: 'Checking availability' } }
      await database.lifecycle.saveObservation(id, snapshot)
      return snapshot
    })().finally(() => pending.delete(id))
    pending.set(id, operation); return operation
  }
  return {
    refresh,
    async decorate(row, admin = false) {
      const data = await database.lifecycle.summary(row.requestId, admin)
      const matches = data.job?.termsDigest === termsDigest(row) && row.createdVaultAddress?.toLowerCase() === data.job?.plan?.vault?.toLowerCase()
      const state = eligibility(matches ? data.observation : null, now())
      return { ...row, lifecycle: { ...data, ...state, termsDigest: termsDigest(row),
        reason: !data.job ? 'Awaiting creation' : data.job.state === 'failed' ? 'Creation needs attention' : state.reason,
        depositable: row.status === 'created' && data.job?.state === 'created' && state.depositable,
      } }
    },
    async context(id, wallet) {
      const [row] = await database.list({ requestId: id, wallet })
      if (!row) throw Object.assign(new Error('Request not found for this wallet.'), { status: 404 })
      await refresh(id)
      const current = await this.decorate(row)
      if (!current.lifecycle.depositable) throw Object.assign(new Error(current.lifecycle.reason), { status: 409 })
      // Only immutable/read-only data; never private transactions or credentials.
      return { request: current, job: { plan: current.lifecycle.job.plan, signer: (await database.lifecycle.job(id)).signer,
        snapshot: (await database.lifecycle.job(id)).snapshot }, snapshot: current.lifecycle.observation }
    },
    async status() { return { creatorConfigured: Boolean(signer), creatorOnline: await database.lifecycle.workerOnline(signer) } },
    async poll() {
      if (running) return
      running = true
      try {
        const jobs = await database.lifecycle.tracked()
        // Bounded concurrency keeps a large queue from overwhelming the RPC.
        let index = 0
        await Promise.all(Array.from({ length: Math.min(4, jobs.length) }, async () => {
          while (index < jobs.length) await refresh(jobs[index++].request_id)
        }))
      } finally { running = false }
    },
  }
}
