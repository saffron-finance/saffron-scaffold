import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'
import { PoolCard } from './PoolCard'
import { CopyPoolImageButton } from './CopyPoolImageButton'
import { usePoolTiles } from './PoolTilesContext'
import { usePoolObservation } from './usePoolObservation'
import { usePoolHistory } from './usePoolHistory'

/** Stable panel controller. Query edits add siblings without renewing existing
 * receipts; export renders only PoolCard, never this controller or its hooks. */
export function LivePoolAprPage({
  config = pools[0],
  tiled = false,
  compact = false,
  onRemove,
}: {
  config?: (typeof pools)[number]
  tiled?: boolean
  compact?: boolean
  onRemove?: () => void
}) {
  const [collapsed, setCollapsed] = useState(tiled)
  useEffect(() => {
    setCollapsed(tiled)
  }, [tiled])
  const location = useLocation(),
    tiles = usePoolTiles()
  const observationKey = tiles?.observationKey ?? `${location.pathname}:${location.key}`
  const model = usePoolObservation(config.id, observationKey)
  const historyState = usePoolHistory(model, collapsed)
  const props = { config, model, historyState, tiled, compact, collapsed, setCollapsed, onRemove }
  const pair = (config.displayOrder ?? [0, 1])
    .map((index) => config.tokens[index].displaySymbol)
    .join(' / ')
  return (
    <PoolCard
      {...props}
      copyControl={
        <CopyPoolImageButton
          poolName={`${pair} ${config.feePips / 10_000}%`}
          renderCapture={() => <PoolCard {...props} exportMode />}
        />
      }
    />
  )
}
