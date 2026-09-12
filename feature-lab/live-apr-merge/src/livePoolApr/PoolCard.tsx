import { useState } from 'react'
import styled, { css, keyframes } from 'styled-components'

import ethLogo from './assets/eth.svg?url'
import uniswapLogo from './assets/uniswap.svg?url'
import robinhoodLogo from './assets/robinhood.svg?url'

import { PoolPageShell } from './PoolPageShell'
import saffronEmblem from './assets/saffron-emblem.png'
import cashcatLogo from './assets/cashcat.jpg'
import usdgLogo from './assets/usdg.png'
import nvdaLogo from './assets/nvda.ico'
import hoodLogo from './assets/hood.jpg'
import ponsLogo from './assets/pons.png'
import shroomLogo from './assets/shroom.jpg'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'
import { q36Number } from './summary-session'

import type { Dispatch, ReactNode, SetStateAction } from 'react'
import type { usePoolObservation } from './usePoolObservation'
import type { usePoolHistory } from './usePoolHistory'
type LivePoolConfig = (typeof pools)[number]
const tokenLogos: Record<string, string> = {
  cashcat: cashcatLogo,
  eth: ethLogo,
  usdg: usdgLogo,
  nvda: nvdaLogo,
  hood: hoodLogo,
  pons: ponsLogo,
  shroom: shroomLogo,
}

// Address-keyed local Uniswap artwork keeps same-symbol tokens distinct.
// Vite fingerprints these files; browsers never fetch third-party token images.
const addressTokenLogos: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>('./assets/uniswap/*', {
      eager: true,
      query: '?url',
      import: 'default',
    })
  ).map(([path, url]) => [path.split('/').pop()!.split('.')[0].toLowerCase(), url])
)

/** Format readable token values without rounding small, nonzero fees to zero. */
function number(value: number, precision = 4) {
  return value.toLocaleString('en-US', { maximumFractionDigits: precision })
}

/** Keep large APR labels compact. Drop the second decimal without changing
 * the underlying estimate or rounding the remaining decimal upward. */
function aprLabel(value: number) {
  const large = value >= 10_000
  return `${number(large ? Math.trunc(value * 10) / 10 : value, large ? 1 : 2)}%`
}

/** Dollar formatting keeps small fees visible and full-size TVL mobile-friendly. */
function dollars(value: number | null, precision = 2) {
  if (value == null || !Number.isFinite(value)) return '—'
  if (value > 0 && value < 0.01) return '<$0.01'
  return value.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  })
}

/** Keep elapsed page time in minutes and seconds, including sessions over an hour. */
function duration(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds))
  const minutes = Math.floor(whole / 60)
  const remaining = whole % 60
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}, ${remaining} ${
    remaining === 1 ? 'second' : 'seconds'
  }`
}

/** Reuse the page's one-second clock; reserve ellipsis width to avoid movement.
 * A stable accessible label avoids announcing each decorative dot change. */
function Calculating({ now }: { now: number }) {
  return (
    <CalculatingText aria-label='Calculating'>
      <span aria-hidden='true'>
        Calculating<CalculatingDots>{'.'.repeat((Math.floor(now / 1000) % 3) + 1)}</CalculatingDots>
      </span>
    </CalculatingText>
  )
}

/**
 * Remount only the displayed number when its count changes. CSS owns the
 * complete 500ms animation; no animation timers, frame loops, or DOM mutations
 * are needed. Replays/timer ticks do not retrigger it, and decreases stay white.
 */
function SwapCounter({ count }: { count: string }) {
  const [pulse, setPulse] = useState({ count, revision: 0, increased: false })
  // Guarded render-time adjustment keeps the new count and its pulse atomic,
  // including multiple swaps arriving before the previous animation finishes.
  if (pulse.count !== count) {
    setPulse({
      count,
      revision: pulse.revision + 1,
      increased: BigInt(count) > BigInt(pulse.count),
    })
  }
  return (
    <SwapCount key={pulse.revision} $pulse={pulse.increased} data-testid='swap-count'>
      {BigInt(count).toLocaleString('en-US')}
    </SwapCount>
  )
}

/** Reuse verified local artwork by token address via the catalog. Unknown assets
 * get an honest symbol badge instead of a broken or unrelated token logo.
 */
function TokenIcon({ token }: { token: LivePoolConfig['tokens'][number] }) {
  const logo = addressTokenLogos[token.address.toLowerCase()] ?? tokenLogos[token.logo]
  return logo ? (
    <PairLogo src={logo} alt='' width={48} height={48} />
  ) : (
    <PairTokenBadge title={token.symbol}>
      {token.displaySymbol.slice(0, 3).toUpperCase()}
    </PairTokenBadge>
  )
}

/** Presentation only. Export mode uses the same values and markup, without
 * controls or secondary details and without attaching a watcher. */
export function PoolCard({
  config,
  model,
  historyState,
  tiled = false,
  compact = false,
  collapsed,
  setCollapsed,
  onRemove,
  copyControl,
  exportMode = false,
}: {
  config: LivePoolConfig
  model: ReturnType<typeof usePoolObservation>
  historyState: ReturnType<typeof usePoolHistory>
  tiled?: boolean
  compact?: boolean
  collapsed: boolean
  setCollapsed: Dispatch<SetStateAction<boolean>>
  onRemove?: () => void
  copyControl?: ReactNode
  exportMode?: boolean
}) {
  const {
    client,
    now,
    summary,
    metrics,
    snapshot,
    baseline,
    paused,
    valuationUnavailable,
    transportUnavailable,
    quoteUsd,
    pageElapsed,
    coverageAge,
    stale,
    rpcStatus,
    rpcTone,
    currentBlock,
    visibleApr,
  } = model
  const {
    historyOpen,
    setHistoryOpen,
    history,
    historyError,
    historyCursor,
    setHistoryCursor,
    historyBusy,
  } = historyState
  const detailsId = `pool-details-${config.id}`,
    historyId = `swap-history-${config.id}`
  const samplingPlaceholder = transportUnavailable ? 'Unavailable' : paused ? '—' : <Calculating now={now} />
  const [token0, token1] = config.tokens
  const [display0, display1] = (config.displayOrder ?? [0, 1]).map((index) => config.tokens[index])
  const quoteToken = config.tokens[config.quoteTokenIndex ?? 1]
  const isV4 = config.protocol === 'v4'
  const feePercent = config.feePips / 10_000
  const pair = `${display0.displaySymbol} / ${display1.displaySymbol}`

  return (
    <PoolPageShell
      cornerControl={!tiled && !exportMode ? copyControl : undefined}
      compactSurface={compact || exportMode}
      title={
        <PairHeading
          data-testid='pool-pair-heading'
          style={
            exportMode ? { gridTemplateAreas: "'logos title' 'logos description'" } : undefined
          }
        >
          <PairLogos aria-hidden='true'>
            <TokenIcon token={display0} />
            <TokenIcon token={display1} />
          </PairLogos>
          <PairHeadingText>
            <PairTitleRow>
              <PairName data-testid='pool-pair-name' title={`${pair} ${feePercent}%`}>
                {pair} {feePercent}%
              </PairName>
              {exportMode ? (
                <PngBrand data-png-brand>
                  <img src={saffronEmblem} alt='Saffron' />
                  <span>saffron.finance</span>
                </PngBrand>
              ) : (
                <WindowControls data-png-exclude>
                  {tiled && copyControl}
                  {tiled && (
                    <WindowButton
                      type='button'
                      aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${pair} details`}
                      aria-expanded={!collapsed}
                      aria-controls={detailsId}
                      onClick={() => setCollapsed((value) => !value)}
                    >
                      <span aria-hidden='true'>{collapsed ? '⛶' : '−'}</span>
                    </WindowButton>
                  )}
                  {onRemove && (
                    <WindowButton
                      type='button'
                      aria-label={`Remove ${config.name.replace(' | Live APR', '')} from page`}
                      onClick={onRemove}
                    >
                      <span aria-hidden='true'>×</span>
                    </WindowButton>
                  )}
                </WindowControls>
              )}
            </PairTitleRow>
            <PoolDescription data-testid='pool-description'>
              <DescriptionItem>
                <UniswapDescriptionLogo src={uniswapLogo} alt='' aria-hidden='true' />
                Uniswap {isV4 ? 'v4' : 'v3'}
              </DescriptionItem>
              <DescriptionItem>
                <DescriptionLogo src={robinhoodLogo} alt='' aria-hidden='true' />
                {config.chainLabel}
              </DescriptionItem>
            </PoolDescription>
          </PairHeadingText>
        </PairHeading>
      }
    >
      <Metrics data-testid='live-metrics'>
        <Metric>
          <Label>Live APR</Label>
          <Apr data-testid='live-apr'>
            {transportUnavailable && !valuationUnavailable
              ? 'APR unavailable'
              : valuationUnavailable
              ? 'Unavailable'
              : visibleApr != null
              ? aprLabel(visibleApr)
              : samplingPlaceholder}
          </Apr>
          <Secondary>
            {transportUnavailable && !valuationUnavailable
              ? visibleApr !== null ? `Last observation (stale): ${aprLabel(visibleApr)}` : 'Waiting for service recovery'
              : valuationUnavailable
              ? summary?.valuationReason === 'no_active_liquidity'
                ? 'No active liquidity'
                : 'Pool price unavailable'
              : paused
              ? 'Paused observation'
              : visibleApr === null
              ? 'Sampling observed onchain data'
              : BigInt(metrics?.count ?? '0') === 0n
              ? 'Waiting for swaps'
              : 'Estimated LP fee yield'}
          </Secondary>
        </Metric>
        <Metric>
          <Label>Swaps watched</Label>
          <SwapCounter key={metrics?.epoch ?? 'pending'} count={metrics?.count ?? '0'} />
          <Secondary>
            {transportUnavailable ? 'Last observation (stale)' : valuationUnavailable ? 'Last priced observation' : 'This page observation'}
          </Secondary>
        </Metric>
        <MetricDivider aria-hidden='true' data-testid='metric-row-divider' />
        <Metric>
          <Label>Pool TVL</Label>
          <Value data-testid='pool-tvl'>
            {valuationUnavailable
              ? 'Unavailable'
              : metrics
              ? dollars(metrics.tvlUsd, 0)
              : samplingPlaceholder}
          </Value>
          <Secondary>{transportUnavailable ? 'Last pool TVL (stale)' : 'Total pool TVL'}</Secondary>
        </Metric>
        <Metric>
          <Label>Estimated fees earned</Label>
          <Value data-testid='estimated-fees'>
            {valuationUnavailable
              ? 'Unavailable'
              : metrics
              ? dollars(metrics.feesUsd)
              : samplingPlaceholder}
          </Value>
          <Secondary>{transportUnavailable ? 'Last fee observation (stale)' : 'Protocol share excluded'}</Secondary>
        </Metric>
      </Metrics>
      {/* Hiding status is visual only: timers, streams and pause warnings stay active. */}
      <div hidden={exportMode || (compact && collapsed)} data-testid='pool-status-section'>
        <SessionSummary>
          <SessionRow>
            <Secondary>Page open</Secondary>
            <TimerValue
              role='timer'
              aria-label='Time this page has been open'
              data-testid='page-open-timer'
            >
              {duration(pageElapsed)}
            </TimerValue>
          </SessionRow>
          <SessionRow>
            <Secondary>RPC status</Secondary>
            <RpcStatus role='status' data-testid='rpc-status'>
              <RpcDot $tone={rpcTone} aria-hidden='true' />
              {rpcStatus}
            </RpcStatus>
          </SessionRow>
          <SessionRow>
            <Secondary>Current block</Secondary>
            <TimerValue
              data-testid='current-block'
              aria-label='Last scanned block'
              title={
                currentBlock === null
                  ? 'Waiting for the first verified scan'
                  : 'Last verified scan block'
              }
            >
              {currentBlock === null
                ? samplingPlaceholder
                : BigInt(currentBlock).toLocaleString('en-US')}
            </TimerValue>
          </SessionRow>
        </SessionSummary>
      </div>
      {paused && (
        <Notice role='status' data-testid='tracking-paused'>
          {summary?.controlUnavailable
            ? 'Tracking temporarily paused—waiting for service recovery.'
            : 'Tracking paused—refresh to resume.'}{' '}
          Last observed values are retained.
          {!summary?.controlUnavailable && (
            <>
              {' '}
              <ReloadButton type='button' onClick={() => window.location.reload()}>
                Refresh page
              </ReloadButton>
            </>
          )}
        </Notice>
      )}
      {stale && (
        <Notice role='status' data-testid='data-stale'>
          Chain data is {duration(coverageAge! / 1000)} old. Last observed values remain visible
          while updates recover.
        </Notice>
      )}
      <div id={detailsId} hidden={exportMode || collapsed} data-testid='pool-details'>
        <Explanation data-testid='batch-disclosure'>
          Shared updates target 20-second batches while this pool has viewers and a page load within
          the last 20 minutes. Swaps in priced observation intervals are counted; TVL is sampled per
          batch.
          {isV4 && ' TVL covers all liquidity ranges; unclaimed fees are excluded.'}
        </Explanation>
        <Explanation>
          Each swap adds its LP fee ÷ pool TVL to the observed return. Onchain updates set the
          observed APR using verified chain time. Between updates, the displayed estimate adjusts
          every 1 second assuming no additional fees. Paused or unpriced intervals are never
          backfilled into your observation.
        </Explanation>
        <FeedHeader>
          <SectionTitle>
            <HistoryToggle
              type='button'
              aria-expanded={historyOpen}
              aria-controls={historyId}
              onClick={() => setHistoryOpen((open) => !open)}
              data-testid='swap-history-toggle'
            >
              Swaps since you opened this page
            </HistoryToggle>
          </SectionTitle>
          <Secondary hidden={!historyOpen}>20 per page | fees valued in USD</Secondary>
        </FeedHeader>
        <div id={historyId} hidden={!historyOpen} data-testid='swap-history-content'>
          {historyError && <Notice role='status'>{historyError}</Notice>}
          {history?.retainedFromMs &&
          baseline &&
          history.retainedFromMs > baseline.coverage.chainTimeMs ? (
            <Notice>
              Older rows have expired from retained history. Your observation totals still include
              every counted swap.
            </Notice>
          ) : null}
          {!history?.rows.length ? (
            <Empty>
              {historyBusy
                ? 'Loading observed swaps…'
                : paused
                ? 'Tracking is paused. Existing observation totals are retained.'
                : 'Waiting for swaps in this observation. Earlier swaps do not count.'}
            </Empty>
          ) : (
            <TableScroll>
              <Table>
                <caption>
                  {display0.symbol}/{display1.symbol} pool swaps and estimated LP earnings
                </caption>
                <thead>
                  <tr>
                    <th scope='col'>Time (UTC)</th>
                    <th scope='col'>Token in</th>
                    <th scope='col'>Amount in</th>
                    <th scope='col'>LP fee (USD)</th>
                    <th scope='col'>Fee / TVL</th>
                    <th scope='col'>Transaction</th>
                  </tr>
                </thead>
                <tbody>
                  {history.rows.map((swap) => (
                    <tr key={swap.id}>
                      <td>{new Date(swap.timestamp).toISOString().slice(11, 19)}</td>
                      <td>
                        {swap.inputAmount === 0
                          ? '—'
                          : swap.inputIs0
                          ? token0.symbol
                          : token1.symbol}
                      </td>
                      <td>
                        {swap.inputAmount === undefined ? '—' : number(Number(swap.inputAmount), 6)}
                      </td>
                      <td>
                        {quoteUsd === null
                          ? '—'
                          : dollars(
                              (swap.lpFeeQuoteQ36
                                ? q36Number(swap.lpFeeQuoteQ36)
                                : swap.lpFeeQuote ?? 0) * quoteUsd
                            )}
                      </td>
                      <td>
                        {number(
                          (swap.feeReturnQ36 ? q36Number(swap.feeReturnQ36) : swap.feeReturn ?? 0) *
                            100,
                          8
                        )}
                        %
                      </td>
                      <td>
                        <ExternalLink
                          href={`${config.explorer}/tx/${swap.transactionHash}`}
                          target='_blank'
                          rel='noreferrer'
                        >
                          View ↗
                        </ExternalLink>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </TableScroll>
          )}
          <HistoryActions>
            {historyCursor !== null && (
              <ReloadButton
                type='button'
                onClick={() => setHistoryCursor(null)}
                disabled={historyBusy}
              >
                Latest page
              </ReloadButton>
            )}
            {history?.nextCursor && (
              <ReloadButton
                type='button'
                onClick={() => setHistoryCursor(history.nextCursor)}
                disabled={historyBusy || paused}
              >
                Older swaps
              </ReloadButton>
            )}
          </HistoryActions>
        </div>
        <Details>
          <summary>Calculation & data sources</summary>
          <p>
            {isV4
              ? 'Uniswap V4 identity is verified from its PoolKey and canonical Initialize event.'
              : 'Uniswap V3 identity is verified on-chain.'}{' '}
            Every viewer of this pool shares one collector. Browser activity, Tokens search, history
            and reconnects never issue individual RPC reads or extend the 20-minute interest timer.
          </p>
          <p>
            Fees are estimated from positive V3 input or negative V4 input deltas, the configured{' '}
            {feePercent}% fee, and the on-chain protocol share. Non-{quoteToken.symbol} fees use the
            swap’s post-swap price. Per-tick integer rounding can differ.
            {isV4
              ? ' V4 TVL sums all initialized liquidity-range principal and excludes unclaimed and protocol fees; shared PoolManager balances are never used.'
              : ' V3 TVL uses the two pool token balances less protocol-owned fees at the verified batch-end price.'}{' '}
            One sampled TVL applies to a whole batch, so within-batch liquidity changes can affect
            this estimate.
          </p>
          <p>
            Cumulative fee/TVL contributions are subtracted from this page’s independent verified
            baseline using fixed-point arithmetic. APR is the resulting return × 31,536,000 ÷
            observed seconds × 100. It is not cumulative fees divided by current TVL. The first
            display waits at least 3 seconds and for a data signal; measured APR requires a verified
            observation interval. This is a pool-wide estimate, not a prediction or a concentrated
            position’s return.
          </p>
          <p>
            Dollar values use the shared {config.usdReference}/USD reference at the displayed
            valuation time, not historical execution-time dollars. Invalid quotes are marked
            unavailable in the next verified summary. Paused values keep their original valuation
            time. No compounding, incentives, gas, impermanent loss or Saffron vault premiums are
            included.
          </p>
          {metrics && (
            <p>
              Observation started: {new Date(metrics.observationStartedAtMs).toISOString()}.{' '}
              Valuation time:{' '}
              {metrics.quoteTimeMs === null
                ? 'Unavailable'
                : new Date(metrics.quoteTimeMs).toISOString()}
              .
            </p>
          )}
          <p>
            Pool:{' '}
            <ExternalLink
              href={
                isV4
                  ? `https://app.uniswap.org/explore/pools/${config.network}/${config.pool}`
                  : `${config.explorer}/address/${config.pool}`
              }
              target='_blank'
              rel='noreferrer'
            >
              {config.pool}
            </ExternalLink>
            .
          </p>
          {snapshot && (
            <p>
              Chain {snapshot.chainId} | covered block{' '}
              {BigInt(snapshot.coverage.throughBlock).toLocaleString('en-US')} |{' '}
              {new Date(snapshot.coverage.chainTimeMs).toISOString()} | provisional chain data.
            </p>
          )}
          {config.tokens.map((token) => (
            <p key={token.address}>
              {token.symbol}: {token.address} | {token.decimals} decimals
            </p>
          ))}
        </Details>
      </div>
    </PoolPageShell>
  )
}

// Match the overlapping round-token treatment used by Saffron's pair rows.
// Both images are bundled locally, so the header needs no token-list API calls.
const PairHeading = styled.span`
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  grid-template-areas: 'logos title' 'logos description';
  align-items: center;
  gap: 7px 16px;
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.body};
  letter-spacing: -0.03em;
  /* Give the title the whole first row on phones; metadata stays underneath. */
  @media (max-width: 699.98px) {
    grid-template-areas: 'title title' 'logos description';
    gap: 12px;
  }
`
const PairLogos = styled.span`
  grid-area: logos;
  display: inline-flex;
  align-items: center;
  flex-shrink: 0;
  > * + * {
    margin-left: -12px;
  }
`
const PairLogo = styled.img`
  display: block;
  width: 48px;
  height: 48px;
  object-fit: cover;
  border: 2px solid ${({ theme }) => theme.colors.background.base};
  border-radius: 50%;
  @media (max-width: 480px) {
    width: 42px;
    height: 42px;
  }
`
const PairTokenBadge = styled.span`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: 48px;
  height: 48px;
  border: 2px solid ${({ theme }) => theme.colors.background.base};
  border-radius: 50%;
  background: #332716;
  color: #efb85d;
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0;
  @media (max-width: 480px) {
    width: 42px;
    height: 42px;
  }
`
const PairHeadingText = styled.span`
  /* Let the existing title and metadata occupy the parent grid directly. */
  display: contents;
`
// Keep compact window controls on the title row, including narrow tile widths.
const PairTitleRow = styled.span`
  grid-area: title;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 8px;
`
const WindowControls = styled.span`
  display: inline-flex;
  flex: none;
  gap: 4px;
  margin-left: auto;
`
const WindowButton = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  border: 1px solid #555;
  border-radius: 0;
  background: #080808;
  color: #ddd;
  font: 28px/1 Arial, sans-serif;
  cursor: pointer;
  &:hover {
    color: #fff;
    border-color: #aaa;
  }
  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
`
const PairName = styled.span`
  /* Match the fixed-income VaultDepositHeader pair's display face and weight;
     keep this page's responsive size so the paired logos still fit on phones. */
  font-family: ${({ theme }) => theme.fonts.display};
  font-size: clamp(24px, 5.8vw, 44px);
  font-weight: 300;
  line-height: 1.12;
  letter-spacing: normal;
  /* Never wrap into the subtitle or push controls out of the title row.
     Exceptionally long names retain their full text in the native tooltip. */
  flex: 1;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`
// Reuse the exact beta assets with text-relative sizing at every width.
const PoolDescription = styled.span`
  grid-area: description;
  font-size: 14px;
  font-weight: 400;
  line-height: 1.4;
  letter-spacing: 0;
  color: ${({ theme }) => theme.colors.text.secondary};
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px 20px;
  @media (max-width: 480px) {
    font-size: 14px;
    gap: 10px 16px;
  }
`
const DescriptionItem = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
`
const DescriptionLogo = styled.img`
  display: block;
  width: 1em;
  height: 1em;
  flex: 0 0 1em;
  object-fit: contain;
`
// The Uniswap artwork needs a 2px optical-size adjustment; Robinhood is unchanged.
const UniswapDescriptionLogo = styled(DescriptionLogo)`
  width: calc(1em + 2px);
  height: calc(1em + 2px);
  flex-basis: calc(1em + 2px);
`
const Topline = styled.div`
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 12px;
  margin-bottom: 24px;
`
const Secondary = styled.span`
  color: ${({ theme }) => (theme.type === 'light' ? '#666666' : '#949494')};
  font-size: 12px;
  line-height: 1.6;
`
const Notice = styled.p`
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
`
const Metrics = styled.div`
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  column-gap: 32px;
  /* Keep the requested 2×2 layout even on narrow phones. minmax(0, 1fr)
     prevents long numeric values from forcing either column wider. The
     full-width divider owns row spacing, avoiding a second grid-gap inset. */
  @media (max-width: 480px) {
    column-gap: 16px;
  }
`
// Use one rule for both separators: identical color, thickness, and 24px
// spacing on each side. The grid divider spans the column gap without a break.
const sectionBoundary = css`
  margin-top: 24px;
  padding-top: 24px;
  border-top: 1px solid ${({ theme }) => theme.colors.border.base};
`
const MetricDivider = styled.div`
  grid-column: 1 / -1;
  ${sectionBoundary}
`
const Metric = styled.div`
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
`
const Label = styled.span`
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 12px;
  line-height: 1.4;
  @media (max-width: 480px) {
    min-height: 2.8em;
  }
`
const Value = styled.div`
  color: ${({ theme }) => theme.colors.text.primary};
  font-family: ${({ theme }) => theme.fonts.display};
  font-size: clamp(20px, 5.2vw, 38px);
  line-height: 1.15;
  font-variant-numeric: tabular-nums;
  overflow-wrap: anywhere;
  @media (max-width: 480px) {
    font-size: clamp(20px, 5.2vw, 25px);
  }
`
// Loading words fit the existing two-column layout even on 320px screens.
const CalculatingText = styled.span`
  display: inline-block;
  font-size: min(1em, clamp(14px, 3.8vw, 22px));
  white-space: nowrap;
`
const CalculatingDots = styled.span`
  display: inline-block;
  width: 0.9em;
  text-align: left;
`
// Scale uses transforms, never font-size, so neighboring metrics do not move.
const swapPulse = keyframes`
  from { color: var(--swap-gold); transform: scale(1.4); }
  to { color: #fff; transform: scale(1); }
`
const swapHighlight = keyframes`
  from { color: var(--swap-gold); }
  to { color: #fff; }
`
const SwapCount = styled(Value)<{ $pulse: boolean }>`
  --swap-gold: ${({ theme }) => theme.colors.accent.gold};
  width: fit-content;
  max-width: 100%;
  color: #fff;
  transform-origin: left center;
  transition: none;
  ${({ $pulse }) =>
    $pulse &&
    css`
      /* Backwards fill applies the large/gold first keyframe before the first
       animation frame; normal direction then only shrinks, never grows. */
      animation: ${swapPulse} 0.5s ease-out 0s 1 normal both;
      @media (prefers-reduced-motion: reduce) {
        animation-name: ${swapHighlight};
      }
    `}
  @media (forced-colors: active) {
    animation: none;
    color: CanvasText;
  }
`
const Apr = styled(Value)`
  width: fit-content;
  max-width: 100%;
  white-space: nowrap;
  color: ${({ theme }) => theme.colors.accent.gold};
  /* Use Saffron's existing gold, orange, and saffron-red palette. The solid
     gold fallback remains readable without clipped-text support. */
  @supports (background-clip: text) or (-webkit-background-clip: text) {
    background-image: linear-gradient(
      110deg,
      ${({ theme }) => theme.colors.accent.gold} 10%,
      ${({ theme }) => theme.colors.accent.orange} 65%,
      ${({ theme }) => theme.colors.primary.saffron} 100%
    );
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
    -webkit-text-fill-color: transparent;
  }
  @media (forced-colors: active) {
    background: none;
    color: CanvasText;
    -webkit-text-fill-color: CanvasText;
  }
`
const SessionSummary = styled.div`
  display: grid;
  gap: 10px;
  ${sectionBoundary}
`
const SessionRow = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 6px 12px;
`
const TimerValue = styled.span`
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 13px;
  font-variant-numeric: tabular-nums;
  line-height: 1.6;
`
const RpcStatus = styled(TimerValue)`
  display: inline-flex;
  align-items: center;
  gap: 8px;
`
// Same plain 9px circle and available/started colors as fixed-income tables.
const RpcDot = styled.span<{ $tone: 'connected' | 'pending' | 'offline' }>`
  width: 9px;
  height: 9px;
  flex-shrink: 0;
  border-radius: var(--radius-full);
  background-color: ${({ theme, $tone }) =>
    $tone === 'connected'
      ? theme.colors.components.vaultStatus.notStarted
      : $tone === 'pending'
      ? theme.colors.components.vaultStatus.started
      : theme.colors.semantic.error};
`
const Explanation = styled.p`
  max-width: 780px;
  margin: 32px 0;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 13px;
  line-height: 1.7;
`
const FeedHeader = styled(Topline)`
  align-items: baseline;
  margin-bottom: 16px;
`
const SectionTitle = styled.h2`
  margin: 0;
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 17px;
  font-weight: 500;
`
// Native button semantics provide Enter/Space activation and a visible focus ring.
const HistoryToggle = styled.button`
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 44px;
  padding: 0;
  border: 0;
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  &::after {
    content: '';
    flex: 0 0 7px;
    width: 7px;
    height: 7px;
    margin-right: 3px;
    border-right: 1.5px solid currentColor;
    border-bottom: 1.5px solid currentColor;
    transform: rotate(-45deg);
  }
  &[aria-expanded='true']::after {
    transform: translateY(-2px) rotate(45deg);
  }
  &:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 4px;
  }
`
const Empty = styled.p`
  margin: 0;
  padding: 28px 0;
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 14px;
`
const TableScroll = styled.div`
  overflow-x: auto;
`
const ExternalLink = styled.a`
  color: ${({ theme }) => theme.colors.text.primary};
  text-decoration: underline;
  &:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 4px;
  }
`
const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: ${({ theme }) => theme.colors.text.primary};
  caption {
    text-align: left;
    font-size: 12px;
    padding-bottom: 12px;
    color: ${({ theme }) => theme.colors.text.secondary};
  }
  th {
    color: ${({ theme }) => theme.colors.text.secondary};
    font-weight: 400;
  }
  th,
  td {
    text-align: right;
    white-space: nowrap;
    padding: 10px 12px;
  }
  th:first-child,
  td:first-child,
  th:nth-child(2),
  td:nth-child(2) {
    text-align: left;
  }
  thead {
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.base};
  }
  tr:nth-child(5n) {
    border-bottom: 1px solid ${({ theme }) => theme.colors.border.base};
  }
`
const Details = styled.details`
  margin-top: 28px;
  padding-top: 20px;
  border-top: 1px solid ${({ theme }) => theme.colors.border.base};
  color: ${({ theme }) => theme.colors.text.secondary};
  font-size: 12px;
  line-height: 1.75;
  overflow-wrap: anywhere;
  summary {
    cursor: pointer;
    color: ${({ theme }) => theme.colors.text.primary};
  }
  p {
    max-width: 860px;
  }
`

const ReloadButton = styled.button`
  color: inherit;
  background: transparent;
  border: 1px solid currentColor;
  border-radius: 4px;
  padding: 6px 10px;
  font: inherit;
  cursor: pointer;
  &:disabled {
    opacity: 0.5;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid currentColor;
    outline-offset: 3px;
  }
`
const HistoryActions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: 12px;
  color: ${({ theme }) => theme.colors.text.primary};
  font-size: 12px;
`

const PngBrand = styled.span`
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  flex: none;
  margin-left: auto;
  padding-left: 12px;
  gap: 4px;
  img {
    width: 48px;
    height: 48px;
    object-fit: contain;
    transform: translate(-4px, -3px);
  }
  span {
    font-family: 'Funnel Display', sans-serif;
    font-size: 14px;
    font-weight: 400;
    line-height: 1.2;
    letter-spacing: normal;
    white-space: nowrap;
    transform: translateY(4px);
    background-image: linear-gradient(180deg, #b747ed 0%, #790ac4 100%);
    background-clip: text;
    -webkit-background-clip: text;
    color: transparent;
  }
`
