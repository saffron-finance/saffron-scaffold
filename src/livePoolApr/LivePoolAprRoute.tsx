import type { ReactNode } from 'react'
import { Navigate, Link, useLocation } from 'react-router-dom'
import styled from 'styled-components'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'
import { LivePoolDashboard } from './LivePoolDashboard'
import { PoolTilesProvider } from './PoolTilesContext'
import { PoolPicker } from './PoolPicker'
import { FIXED_INCOME_APR_PATH, poolAtPath } from './routing'

/** One parameterized feature route, mounted inside either existing host router.
 * Alias redirects run before admission; query edits keep keyed viewers alive. */
export default function LivePoolAprRoute({
  basePath = FIXED_INCOME_APR_PATH,
  header,
}: {
  basePath?: string
  header?: ReactNode
}) {
  const location = useLocation()
  const selected = poolAtPath(location.pathname, basePath)
  if (!selected)
    return (
      <section>
        <h1>Pool not found</h1>
        <Link to={basePath}>Browse tracked pools</Link>
      </section>
    )
  if (location.pathname !== selected.canonicalPath)
    return (
      <Navigate
        replace
        to={{ pathname: selected.canonicalPath, search: location.search, hash: location.hash }}
      />
    )
  return (
    <PoolTilesProvider basePath={basePath}>
      {header ?? (
        <Toolbar>
          <PoolPicker />
        </Toolbar>
      )}
      <LivePoolDashboard
        key={selected.id}
        config={pools.find((pool) => pool.id === selected.id)!}
      />
    </PoolTilesProvider>
  )
}
const Toolbar = styled.div`
  display: flex;
  justify-content: flex-end;
  margin-bottom: 12px;
`
