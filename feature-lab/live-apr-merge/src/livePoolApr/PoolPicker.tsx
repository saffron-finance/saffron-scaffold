import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation } from 'react-router-dom'
import styled, { css } from 'styled-components'
import { DROPDOWN_MENU_ITEM, DropdownMenu, mediaQuery } from './ui'
import pools from '@packages/onchain-config/live-pool-apr/pools.json'
import { MAX_POOL_TILES, usePoolTiles } from './PoolTilesContext'
import { poolPath } from './routing'
export type OpenMenu = { id: string; pinned: boolean } | null
export type NavItem = {
  poolId?: string
  path: string
  label: string
  searchText?: string
  detail?: string
  // Host destinations leave the portable router; pool links stay client-side.
  hostLink?: boolean
}

// The same catalog drives routes and this menu; selecting one route mounts only
// that pool's listener. Searching, rendering, and hover never request pool data.
const poolLabels = pools.map(
  (pool) =>
    `${(pool.displayOrder ?? [0, 1])
      .map((index) => pool.tokens[index].displaySymbol)
      .join(' / ')} ${pool.feePips / 10_000}%`
)
const labelCounts = poolLabels.reduce<Map<string, number>>(
  (counts, label) => counts.set(label, (counts.get(label) ?? 0) + 1),
  new Map()
)
const catalogItems: NavItem[] = pools
  .map((pool, index) => ({
    poolId: pool.id,
    path: pool.path,
    label: poolLabels[index],
    // Symbols are not unique identifiers. Duplicate pair/fee labels show a short
    // pool address; full pool and token addresses are always searchable.
    detail:
      (labelCounts.get(poolLabels[index]) ?? 0) > 1
        ? `${pool.pool.slice(0, 8)}…${pool.pool.slice(-6)}`
        : undefined,
    searchText: [
      poolLabels[index],
      pool.pool,
      ...pool.tokens.flatMap((token) => [token.symbol, token.displaySymbol, token.address]),
    ]
      .join(' ')
      .toLowerCase(),
  }))
  .sort(
    (left, right) =>
      left.label.localeCompare(right.label, undefined, { numeric: true }) ||
      left.path.localeCompare(right.path)
  )

/** Shared mouse/touch/keyboard menu. Hover previews, clicks pin, and Escape
 * returns focus to the trigger. Tokens adds an independent search field above
 * the scrollable menu; Explore retains its original simple-menu behavior.
 */
export function NavDropdown({
  id,
  label,
  items,
  active,
  currentPath,
  open,
  setOpen,
  searchable = false,
}: {
  id: string
  label: string
  items: NavItem[]
  active: boolean
  currentPath: string
  open: OpenMenu
  setOpen: (value: OpenMenu) => void
  searchable?: boolean
}) {
  const tiles = usePoolTiles()
  const wrapper = useRef<HTMLDivElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const pendingFocus = useRef<'first' | 'last' | 'search' | null>(null)
  const [query, setQuery] = useState('')
  const [limitPointer, setLimitPointer] = useState<{ x: number; y: number } | null>(null)
  const atCapacity = (tiles?.poolIds.length ?? 0) >= MAX_POOL_TILES
  const isOpen = open?.id === id
  const close = useCallback(() => setOpen(null), [setOpen])
  // Clear stale pointer feedback when filtering, closing or freeing a slot.
  useEffect(() => setLimitPointer(null), [isOpen, query, atCapacity])
  // Ignore separators so CASHCAT/USDG and CASHCAT USDG both match. Multiple
  // terms narrow the same row, including a fee tier or a partial address.
  const terms = query.toLowerCase().replace(/[\/|]/g, ' ').trim().split(/\s+/).filter(Boolean)
  const visibleItems = searchable
    ? items.filter((item) =>
        terms.every((term) => (item.searchText ?? item.label.toLowerCase()).includes(term))
      )
    : items
  const focusItem = (last = false) => {
    const links = wrapper.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)')
    if (links?.length) links[last ? links.length - 1 : 0].focus()
  }

  useEffect(() => {
    if (!isOpen) return
    if (pendingFocus.current === 'search') search.current?.focus()
    else if (pendingFocus.current) {
      const links = wrapper.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not(:disabled)'
      )
      if (links?.length) links[pendingFocus.current === 'last' ? links.length - 1 : 0].focus()
    }
    pendingFocus.current = null
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) close()
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        close()
        trigger.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [isOpen, open?.pinned, close])

  return (
    <ExploreWrapper
      ref={wrapper}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse' && !isOpen) {
          setQuery('')
          setOpen({ id, pinned: false })
        }
      }}
      onPointerLeave={() => {
        if (isOpen && !open?.pinned) close()
      }}
      onBlur={(event) => {
        // Some browsers blur the search field without focusing a clicked link.
        // A null target must not unmount that link before its click can navigate;
        // outside pointer presses and successful selections already close us.
        if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget as Node))
          close()
      }}
    >
      <ExploreTrigger
        ref={trigger}
        id={`${id}-trigger`}
        type='button'
        $active={active}
        aria-haspopup={searchable ? 'dialog' : 'menu'}
        aria-expanded={isOpen}
        aria-controls={`${id}-menu`}
        onClick={() => {
          if (isOpen && open?.pinned) {
            close()
            return
          }
          if (!isOpen) setQuery('')
          pendingFocus.current = searchable ? 'search' : null
          setOpen({ id, pinned: true })
        }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
          event.preventDefault()
          if (isOpen) {
            if (searchable) search.current?.focus()
            else focusItem(event.key === 'ArrowUp')
            setOpen({ id, pinned: true })
          } else {
            setQuery('')
            pendingFocus.current = searchable
              ? 'search'
              : event.key === 'ArrowUp'
              ? 'last'
              : 'first'
            setOpen({ id, pinned: true })
          }
        }}
      >
        {label}
        <Caret aria-hidden='true' viewBox='0 0 10 6'>
          <path d='M1 1l4 4 4-4' />
        </Caret>
      </ExploreTrigger>
      {isOpen && (
        <ExploreDropdown
          id={`${id}-menu`}
          data-nav-dropdown
          role={searchable ? 'dialog' : 'menu'}
          aria-labelledby={`${id}-trigger`}
          $alignRight={id === 'tokens'}
          $searchable={searchable}
          onKeyDown={(event) => {
            // Text editing keys must stay in the input; only the result links use
            // menu-style Home/End and arrow navigation.
            if (
              event.target === search.current ||
              !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)
            )
              return
            event.preventDefault()
            const links = [
              ...event.currentTarget.querySelectorAll<HTMLElement>(
                '[role="menuitem"]:not(:disabled)'
              ),
            ]
            const index = links.indexOf(document.activeElement as HTMLElement)
            if (searchable && event.key === 'ArrowUp' && index === 0) {
              search.current?.focus()
              return
            }
            const next =
              event.key === 'Home'
                ? 0
                : event.key === 'End'
                ? links.length - 1
                : (index + (event.key === 'ArrowDown' ? 1 : -1) + links.length) % links.length
            links[next]?.focus()
          }}
        >
          {searchable && (
            <SearchHeader>
              <TokenSearch
                ref={search}
                type='search'
                value={query}
                placeholder='Search tokens, fee, or address'
                aria-label='Search token pools'
                aria-controls={`${id}-results`}
                autoComplete='off'
                spellCheck={false}
                onFocus={() => {
                  if (!open?.pinned) setOpen({ id, pinned: true })
                }}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                    event.preventDefault()
                    focusItem(event.key === 'ArrowUp')
                  } else if (event.key === 'Enter') {
                    event.preventDefault()
                    // Native link activation preserves the same routing/cleanup as a
                    // pointer selection; filtering itself never subscribes to pools.
                    wrapper.current
                      ?.querySelector<HTMLElement>('[role="menuitem"]:not(:disabled)')
                      ?.click()
                  }
                }}
              />
              <SearchCount role='status' aria-live='polite'>
                {visibleItems.length} of {items.length} pools
              </SearchCount>
            </SearchHeader>
          )}
          <MenuResults
            id={`${id}-results`}
            role={searchable ? 'menu' : undefined}
            onScroll={() => setLimitPointer(null)}
            aria-label={searchable ? 'Token pools' : undefined}
            $scrollable={searchable}
          >
            {visibleItems.map((item) => (
              <TokenMenuRow
                key={item.path}
                $withAdd={Boolean(item.poolId)}
                onPointerMove={(event) => {
                  // Handle hover on the row because disabled buttons suppress click/mouse events.
                  const button = (event.target as Element).closest('button')
                  setLimitPointer(
                    atCapacity && item.poolId && !tiles?.poolIds.includes(item.poolId) && button
                      ? {
                          x: Math.max(120, Math.min(window.innerWidth - 120, event.clientX)),
                          y: event.clientY - 12,
                        }
                      : null
                  )
                }}
                onPointerLeave={() => setLimitPointer(null)}
              >
                {item.hostLink ? (
                  <ExploreItem as='a' role='menuitem' href={item.path} $active={false} onClick={close}>
                    <span>{item.label}</span>
                  </ExploreItem>
                ) : <ExploreItem
                  role='menuitem'
                  to={item.path}
                  $active={currentPath === item.path}
                  aria-current={currentPath === item.path ? 'page' : undefined}
                  onClick={close}
                >
                  <span>{item.label}</span>
                  {item.detail && <ItemDetail>{item.detail}</ItemDetail>}
                </ExploreItem>}
                {item.poolId && (
                  <AddToPage
                    type='button'
                    role='menuitem'
                    aria-label={`Add ${item.label}${
                      item.detail ? ` (${item.detail})` : ''
                    } to page`}
                    disabled={tiles?.poolIds.includes(item.poolId) || !tiles?.canAdd}
                    onClick={() => {
                      tiles?.addPool(item.poolId!)
                      setOpen({ id, pinned: true })
                    }}
                  >
                    {tiles?.poolIds.includes(item.poolId) ? 'Added' : '+ Add to page'}
                  </AddToPage>
                )}
              </TokenMenuRow>
            ))}
            {searchable && !visibleItems.length && <NoResults>No matching pools</NoResults>}
          </MenuResults>
        </ExploreDropdown>
      )}
      {/* Portal avoids clipping by the scrollable results; never intercept the pointer. */}
      {isOpen &&
        atCapacity &&
        limitPointer &&
        createPortal(
          <LimitTooltip role='tooltip' style={{ left: limitPointer.x, top: limitPointer.y }}>
            Maximum of 4 pairs reached.
          </LimitTooltip>,
          document.body
        )}
    </ExploreWrapper>
  )
}

const LimitTooltip = styled.span`
  position: fixed;
  transform: translate(-50%, -100%);
  z-index: 10000;
  pointer-events: none;
  padding: 6px 8px;
  background: #000;
  color: #fff;
  font: 13px/1.4 sans-serif;
  white-space: nowrap;
  letter-spacing: normal;
`

/** Feature-local picker; both host adapters use these same interactions. */
export function PoolPicker({ menuState }: {
  menuState?: { open: OpenMenu; setOpen: (value: OpenMenu) => void }
} = {}) {
  const location = useLocation()
  const tiles = usePoolTiles()
  const [localOpen, setLocalOpen] = useState<OpenMenu>(null)
  // A standalone navbar shares menu state so opening one closes the other.
  // Embedded hosts can keep using the picker without managing its state.
  const { open, setOpen } = menuState ?? { open: localOpen, setOpen: setLocalOpen }
  useEffect(() => setOpen(null), [location.pathname])
  const items = catalogItems.map((item) => ({
    ...item,
    path: poolPath(item.poolId!, tiles?.basePath),
  }))
  return (
    <NavDropdown
      id='tokens'
      label='Tokens'
      items={items}
      searchable
      active
      currentPath={location.pathname.replace(/\/+$/, '')}
      open={open}
      setOpen={setOpen}
    />
  )
}
const ExploreWrapper = styled.div`
  position: relative;
  height: 44px;
  display: flex;
  align-items: center;
`

const ExploreTrigger = styled.button<{ $active: boolean }>`
  height: 44px;
  padding: 0 20px;
  display: flex;
  align-items: center;
  gap: 8px;
  border: 0;
  background: transparent;
  color: ${({ $active, theme }) =>
    $active ? theme.colors.text.primary : theme.colors.text.tertiary};
  font-family: ${({ theme }) => theme.fonts.body};
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: pointer;
  text-decoration: none;
  white-space: nowrap;

  &:hover {
    color: ${({ theme }) => theme.colors.text.primary};
  }
  &:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: 2px;
  }

  ${mediaQuery('small')} {
    padding: 0 10px;
  }
`

const Caret = styled.svg`
  width: 10px;
  height: 6px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.5;
  stroke-linecap: round;
  stroke-linejoin: round;
`

const ExploreDropdown = styled(DropdownMenu)<{ $alignRight: boolean; $searchable: boolean }>`
  top: calc(100% - 4px);
  left: 0;
  width: max-content;
  min-width: 205px;
  max-width: calc(100vw - 32px);
  ${({ $alignRight }) =>
    $alignRight &&
    css`
      left: auto;
      right: 0;
    `}
  ${({ $searchable }) =>
    $searchable &&
    css`
      /* Keep search fixed above results, with a viewport-safe width on phones. */
      width: min(460px, calc(100vw - 72px));
      min-width: 0;
      max-height: min(360px, calc(100vh - 110px));
      max-height: min(360px, calc(100dvh - 110px));
      overflow: hidden;
    `}
`

const SearchHeader = styled.div`
  flex: none;
  padding: 6px;
  border-bottom: 1px solid ${({ theme }) => theme.colors.border.base};
`

const TokenSearch = styled.input`
  display: block;
  width: 100%;
  box-sizing: border-box;
  min-width: 0;
  padding: 9px 8px;
  border: 1px solid ${({ theme }) => theme.colors.border.base};
  border-radius: var(--radius-xs);
  background: ${({ theme }) => theme.colors.background.base};
  color: ${({ theme }) => theme.colors.text.primary};
  font-family: ${({ theme }) => theme.fonts.body};
  /* Avoid the iOS zoom triggered by focusing inputs smaller than 16px. */
  font-size: 16px;
  &::placeholder {
    color: ${({ theme }) => theme.colors.text.tertiary};
    font-size: 12px;
  }
  &:focus {
    outline: 1px solid ${({ theme }) => theme.colors.text.secondary};
  }
`

const SearchCount = styled.div`
  padding: 6px 2px 0;
  color: ${({ theme }) => theme.colors.text.tertiary};
  font-family: ${({ theme }) => theme.fonts.body};
  font-size: 11px;
`

const MenuResults = styled.div<{ $scrollable: boolean }>`
  display: flex;
  flex-direction: column;
  gap: 2px;
  ${({ $scrollable }) =>
    $scrollable &&
    css`
      min-height: 0;
      overflow-y: auto;
      overscroll-behavior: contain;
      scrollbar-gutter: stable;
      scrollbar-width: thin;
      scrollbar-color: ${({ theme }) => theme.colors.text.tertiary} transparent;
      &::-webkit-scrollbar {
        width: 6px;
      }
      &::-webkit-scrollbar-thumb {
        background: ${({ theme }) => theme.colors.text.tertiary};
        border-radius: 6px;
      }
    `}
`

// Keep the add control separate from the link so it never navigates or closes
// the menu. Token rows use the requested spacing and dark outlined buttons.
const TokenMenuRow = styled.div<{ $withAdd: boolean }>`
  display: grid;
  grid-template-columns: ${({ $withAdd }) => ($withAdd ? 'minmax(0, 1fr) auto' : 'minmax(0, 1fr)')};
  align-items: center;
  gap: 6px;
  padding: ${({ $withAdd }) => ($withAdd ? '8px 4px 0px 0' : '0')};
  > a {
    min-width: 0;
  }
  /* Only add-button hover uses this gradient; native token-link hover stays red. */
  &:has(> button:hover) > a {
    background: radial-gradient(
        75% 95% at 78% 0%,
        rgba(255, 87, 0, 0.44),
        rgba(145, 39, 181, 0.21) 38%,
        transparent 66%
      ),
      rgb(43 8 74);
    opacity: 1;
  }
`
const AddToPage = styled.button`
  padding: 8px;
  min-height: 30px;
  border: 1px solid #555;
  border-radius: 0;
  background: #000;
  color: #fff;
  font-family: ${({ theme }) => theme.fonts.body};
  font-size: 11px;
  font-weight: 400;
  line-height: 1.2;
  white-space: nowrap;
  cursor: pointer;
  &:hover:not(:disabled) {
    border-color: #aaa;
  }
  &:disabled {
    opacity: 0.55;
    cursor: default;
  }
  &:focus-visible {
    outline: 2px solid #fff;
    outline-offset: 2px;
  }
`

const ExploreItem = styled(Link)<{ $active: boolean }>`
  ${DROPDOWN_MENU_ITEM}
  flex: none;
  flex-direction: column;
  align-items: flex-start;
  overflow-wrap: anywhere;
  background: ${({ $active, theme }) => ($active ? theme.colors.primary.soft : 'transparent')};
  &:focus-visible {
    outline: 1px solid currentColor;
    outline-offset: -2px;
  }
`

const ItemDetail = styled.span`
  margin-top: 3px;
  font-size: 10px;
  color: ${({ theme }) => theme.colors.text.secondary};
  text-transform: none;
`

const NoResults = styled.div`
  padding: 18px 10px;
  font-family: ${({ theme }) => theme.fonts.body};
  font-size: 13px;
  color: ${({ theme }) => theme.colors.text.secondary};
`
