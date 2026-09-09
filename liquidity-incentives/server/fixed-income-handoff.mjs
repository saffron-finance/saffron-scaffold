import { validAddress } from '../shared/vault-request.mjs'
import { depositCents } from '../shared/vault-sizing.mjs'
import { encodeAdminCreateVaultUrlParams, pendingVaultToUrlParams } from '../vendor/fixed-income-api/createVaultUrlParams.mjs'

export class HandoffError extends Error {
  constructor(status, message) { super(message); this.status = status }
}
const fail = (status, message) => new HandoffError(status, message)

/** Operator-owned public app/API bases. No credentials, redirects or caller URLs. */
function baseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('Invalid fixed-income URL configuration.') }
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:'))
    || url.username || url.password || url.search || url.hash || !/^\/[a-zA-Z0-9/_-]*$/.test(url.pathname)) {
    throw new Error('Invalid fixed-income URL configuration.')
  }
  return url.href.replace(/\/$/, '')
}

// Match the canonical row, not just a coincidentally identical public ID.
function sameRequest(local, remote) {
  const addresses = ['submitterAddress', 'token0Address', 'token1Address', 'poolAddress',
    'fixedCapacityTokenAddress', 'variableAssetAddress', 'createdVaultAddress']
  const values = ['requestId', 'chainId', 'status', 'feeTier', 'adapterType', 'minTick', 'maxTick',
    'durationSeconds', 'fixedCapacityAmount', 'variableAssetAmount', 'useTargetApr', 'targetApr']
  const canonical = value => value == null ? null : value
  return addresses.every(key => canonical(local[key]?.toLowerCase()) === canonical(remote[key]?.toLowerCase()))
    && values.every(key => canonical(local[key]) === canonical(remote[key]))
}

/** Read-only handoff. Both services must use the same canonical pending queue. */
export function createFixedIncomeHandoff({ frontendUrl, apiUrl, fetchImpl = fetch } = {}) {
  if (!frontendUrl && !apiUrl) return null
  const frontend = baseUrl(frontendUrl), api = baseUrl(apiUrl)
  let active = 0
  return async (row, action) => {
    if (!['create', 'fixed', 'variable'].includes(action) || row.chainId !== 4663
      || !/^[A-Z0-9]{12}$/.test(row.requestId) || !validAddress(row.submitterAddress)) {
      throw fail(400, 'Invalid vault handoff.')
    }
    if (action === 'create') {
      if (row.status !== 'pending') throw fail(409, 'This request is no longer pending. Refresh requests.')
      const cents = depositCents(row.display.depositUsd)
      if (!cents || row.fixedCapacityAmount !== cents) {
        throw fail(409, 'This request needs a vault sizing review before creation. Its saved receipt is unchanged.')
      }
    } else if (row.status !== 'created' || !validAddress(row.createdVaultAddress)) {
      throw fail(409, 'The created vault is not available yet. Refresh requests.')
    }
    if (active >= 4) throw fail(429, 'Vault handoff is busy. Retry shortly.')
    active++
    try {
      const response = await fetchImpl(`${api}/api/v1/pending-vaults/${row.chainId}/my-submissions/${row.submitterAddress.toLowerCase()}`, {
        redirect: 'error', signal: AbortSignal.timeout(8000), headers: { accept: 'application/json' },
      })
      if (!response.ok) throw new Error('API unavailable')
      // Bound even chunked responses, rather than trusting Content-Length.
      const reader = response.body.getReader()
      const chunks = []; let size = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          size += value.length
          if (size > 1_000_000) throw new Error('API response too large')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      const payload = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      if (payload.success !== true || !Array.isArray(payload.data)) throw new Error('Invalid API response')
      const matches = payload.data.filter(item => item?.requestId === row.requestId)
      if (matches.length !== 1 || !sameRequest(row, matches[0])) {
        throw fail(409, 'Fixed-income does not show this same request yet. Refresh, or ask the operator to check the shared queue connection.')
      }
    } catch (error) {
      if (error instanceof HandoffError) throw error
      throw fail(503, 'Fixed-income is unavailable. Retry the handoff without paying again.')
    } finally { active-- }
    const network = `${frontend}/network/robinhood`
    if (action !== 'create') return `${network}/vault/${row.createdVaultAddress.toLowerCase()}/${action}`
    // Incentive durations are integral days. Preserve them exactly; do not
    // approximate months or construct a second set of URL parameter rules.
    const params = pendingVaultToUrlParams(row, { months: 0, weeks: 0, days: row.durationSeconds / 86400, hours: 0 })
    return `${network}/admin/create-vault?${encodeAdminCreateVaultUrlParams(params)}`
  }
}
