import { createContext, useContext, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'
import { canonicalPoolId } from './poolAliases'
import { poolAtPath, STAGING_APR_PATH } from './routing'
import type { ReactNode } from 'react'

interface PoolTiles {
  basePath: string
  poolIds: string[]
  observationKey: string
  canAdd: boolean
  addPool: (id: string) => void
  removePool: (id: string) => void
}
const Context = createContext<PoolTiles | null>(null)
export const usePoolTiles = () => useContext(Context)
export const MAX_POOL_TILES = 4
const catalogIds = new Set(pools.map((pool) => pool.id))

/** The path owns the base pool; repeated compare parameters own extra tiles.
 * Query changes must not remount existing panels or renew their paid interest. */
export function PoolTilesProvider({
  children,
  basePath = STAGING_APR_PATH,
}: {
  children: ReactNode
  basePath?: string
}) {
  const location = useLocation()
  const primary = poolAtPath(location.pathname, basePath)?.id
  return (
    <Selection key={location.pathname} primary={primary} basePath={basePath}>
      {children}
    </Selection>
  )
}

/** Read only known, unique pool IDs from shared URLs. Keep other query fields
 * intact, and replace the URL so each add/remove does not flood browser history. */
function Selection({
  primary,
  children,
  basePath,
}: {
  primary?: string
  children: ReactNode
  basePath: string
}) {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  // Stable across query edits; a different base route starts a new observation.
  const [observationKey] = useState(() => `${location.pathname}:${location.key}`)
  const added = [...new Set(params.getAll('compare').map(canonicalPoolId))]
    .filter((id) => id !== primary && catalogIds.has(id))
    .slice(0, MAX_POOL_TILES - 1)
  const poolIds = primary ? [primary, ...added] : []
  const update = (ids: string[]) => {
    const next = new URLSearchParams(params)
    next.delete('compare')
    for (const id of ids) next.append('compare', id)
    setParams(next, { replace: true, preventScrollReset: true })
  }
  return (
    <Context.Provider
      value={{
        basePath,
        poolIds,
        observationKey,
        canAdd: Boolean(primary) && poolIds.length < MAX_POOL_TILES,
        addPool: (id) => {
          if (
            !primary ||
            poolIds.length >= MAX_POOL_TILES ||
            id === primary ||
            !catalogIds.has(id) ||
            added.includes(id)
          )
            return
          update([...added, id])
        },
        removePool: (id) => {
          if (added.includes(id)) update(added.filter((poolId) => poolId !== id))
        },
      }}
    >
      {children}
    </Context.Provider>
  )
}
