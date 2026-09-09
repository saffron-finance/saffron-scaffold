import { validAddress } from './vault-request.mjs'

const id = (value) => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value)
const revision = (value) => Number.isSafeInteger(value) && value >= 0
const token = (value) => value && validAddress(value.address) && typeof value.symbol === 'string' && /^[A-Za-z0-9._-]{1,20}$/.test(value.symbol)
  && Number.isInteger(value.decimals) && value.decimals >= 0 && value.decimals <= 18
const positive = (value, max) => typeof value === 'number' && Number.isFinite(value) && value > 0 && value <= max
// Pending-vault capacity is stored in USD cents and target APR in a ratio with four decimals.
const hundredths = (value, max) => positive(value, max) && value >= 0.01 && Number(value.toFixed(2)) === value

export function validPair(value) {
  return Boolean(value && id(value.id) && revision(value.revision) && value.chainId === 4663
    && validAddress(value.pool) && [100, 500, 3000, 10000].includes(value.feeTier)
    && token(value.token0) && token(value.token1)
    && value.token0.address.toLowerCase() !== value.token1.address.toLowerCase()
    && typeof value.active === 'boolean')
}

export function canonicalPair(value) {
  const copyToken = (v) => ({ address: v.address.toLowerCase(), symbol: v.symbol, decimals: v.decimals })
  return { id: value.id, revision: value.revision, chainId: value.chainId, pool: value.pool.toLowerCase(),
    feeTier: value.feeTier, token0: copyToken(value.token0), token1: copyToken(value.token1), active: value.active }
}

export function validProgram(value) {
  return Boolean(value && id(value.id) && revision(value.revision) && id(value.pairId)
    && hundredths(value.apr, 100000) && Number.isInteger(value.days) && value.days > 0 && value.days <= 3650
    && hundredths(value.capacityUsd, 1e12) && Number.isInteger(value.sortOrder) && Math.abs(value.sortOrder) <= 100000
    && typeof value.isNew === 'boolean' && typeof value.active === 'boolean')
}

export function canonicalProgram(value) {
  return { id: value.id, revision: value.revision, pairId: value.pairId, apr: value.apr,
    days: value.days, capacityUsd: value.capacityUsd, sortOrder: value.sortOrder, isNew: value.isNew, active: value.active }
}

/** A write proof names the complete edit. A list signature can never authorize a write. */
export function programAdminMessage({ wallet, chainId, action, payload, nonce, expiresAt }) {
  return ['Saffron Scaffold: manage liquidity incentive offers',
    action === 'list' ? 'Read the admin catalog.' : 'Save this catalog edit. No payment or blockchain transaction is authorized.',
    `Wallet: ${wallet.toLowerCase()}`, `Chain: ${chainId}`, `Action: ${action}`,
    `Edit: ${JSON.stringify(payload)}`, `Nonce: ${nonce}`, `Expires: ${expiresAt}`].join('\n')
}
