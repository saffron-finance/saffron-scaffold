import pools from '@packages/onchain-config/live-pool-apr/pools.json'
import { canonicalPoolId } from './poolAliases'

export const STAGING_APR_PATH = '/apps/live-pool-apr'
export const FIXED_INCOME_APR_PATH = '/network/robinhood/live-apr'
// Default presentation is explicit; catalog ordering must not change pool identity.
export const DEFAULT_POOL_ID = 'nvda-usdg-005'
const ids = new Set(pools.map((pool) => pool.id))

/** Build relative router paths only; deployment basename belongs to the host. */
export function poolPath(id: string, basePath = STAGING_APR_PATH) {
  const canonical = canonicalPoolId(id)
  return `${basePath.replace(/\/+$/, '')}${canonical === DEFAULT_POOL_ID ? '' : `/${canonical}`}` || '/'
}
/** Resolve an allowlisted identity without mounting an arbitrary-address watcher. */
export function poolAtPath(pathname: string, basePath = STAGING_APR_PATH) {
  const path = pathname.replace(/\/+$/, ''),
    root = basePath.replace(/\/+$/, '')
  const raw =
    path === root ? DEFAULT_POOL_ID : path.startsWith(root + '/') ? path.slice(root.length + 1) : ''
  const id = canonicalPoolId(raw)
  return ids.has(id) ? { id, canonicalPath: poolPath(id, root) } : null
}
