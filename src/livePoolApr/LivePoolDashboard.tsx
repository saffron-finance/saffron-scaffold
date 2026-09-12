import styled from 'styled-components'
import { LivePoolAprPage } from './LivePoolAprPage'
import { usePoolTiles } from './PoolTilesContext'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'

/** Stable keyed panels preserve timers, baselines and streams as siblings are
 * added or removed. Unmounting a panel releases only that pool's observation. */
export function LivePoolDashboard({ config }: { config: (typeof pools)[number] }) {
  const tiles = usePoolTiles()
  const ids = tiles?.poolIds.length ? tiles.poolIds : [config.id]
  const tiled = ids.length > 1
  return (
    <Grid $tiled={tiled} data-testid='pool-grid' data-tiled={tiled}>
      {ids.map((id) => {
        const pool = pools.find((candidate) => candidate.id === id)!
        return (
          <Tile key={id} $tiled={tiled} data-pool-id={id}>
            <LivePoolAprPage
              config={pool}
              tiled={tiled}
              compact={ids.length >= 3}
              onRemove={id !== config.id ? () => tiles?.removePool(id) : undefined}
            />
          </Tile>
        )
      })}
    </Grid>
  )
}

const Grid = styled.div<{ $tiled: boolean }>`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 24px;
  align-items: start;
  @media (min-width: 1000px) {
    grid-template-columns: ${({ $tiled }) =>
      $tiled ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)'};
  }
`
const Tile = styled.div<{ $tiled: boolean }>`
  min-width: 0;
  position: relative;
  ${({ $tiled }) =>
    $tiled &&
    `
    border: 1px solid #292929;
    padding: 14px;
    /* Comparison titles have the same 24px minimum and maximum. */
    [data-testid='pool-pair-name'] { font-size: 24px; }
  `}
  @media (max-width: 480px) {
    padding: 0;
    border: 0;
  }
`
