import styled, { css } from 'styled-components'

import { StylingProps } from '../../styles'
import { mediaQuery } from '../../utils/mediaQuery'
import { ChevronIcon, ChevronUpIcon, ChevronUpDownIcon } from '../Icons'

const SORT_ICON_SIZE = 20
// The chevron shrinks with the label it sits beside (the header drops to 10px
// on a phone). At the desktop size it is wider than the two-letter gap a narrow
// column has left over, and it was the piece that overran the last column —
// the whole cell is the tap target either way, so nothing gets harder to hit.
const SORT_ICON_SIZE_SMALL = 14

export type SortDirection = 'asc' | 'desc' | null

/**
 * The sort chevron for a column header: up when sorted asc, down when desc,
 * up-down when this column isn't the active sort. The single source of truth
 * for the app's sort affordance — used by SortableHeaderCell (whole cell is the
 * hit target) and by ColumnFilterDropdown, whose label is already a filter
 * trigger so only the arrow can carry the sort.
 */
export function SortIndicator({ sortDirection }: { sortDirection?: SortDirection }) {
  const icon =
    sortDirection === 'asc' ? (
      <ChevronUpIcon size={SORT_ICON_SIZE} />
    ) : sortDirection === 'desc' ? (
      <ChevronIcon size={SORT_ICON_SIZE} />
    ) : (
      <ChevronUpDownIcon size={SORT_ICON_SIZE} />
    )
  return <SortIndicatorWrapper>{icon}</SortIndicatorWrapper>
}

interface SortableHeaderCellProps extends StylingProps {
  width?: string
  align?: 'left' | 'center' | 'right'
  sortDirection?: SortDirection
  defaultDirection?: 'asc' | 'desc'
  onSort?: (defaultDirection?: 'asc' | 'desc') => void
  children: React.ReactNode
}

export function SortableHeaderCell({
  width,
  align,
  sortDirection,
  defaultDirection,
  onSort,
  children,
  className,
}: SortableHeaderCellProps) {
  return (
    <HeaderCell
      width={width}
      align={align}
      sortable={!!onSort}
      onClick={() => onSort?.(defaultDirection)}
      className={className}
    >
      <HeaderCellContent>
        {children}
        {onSort && <SortIndicator sortDirection={sortDirection} />}
      </HeaderCellContent>
    </HeaderCell>
  )
}

const HeaderCellContent = styled.div`
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 8px;
  ${mediaQuery('small')} {
    gap: 2px;
  }
`

const SortIndicatorWrapper = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
  width: ${SORT_ICON_SIZE}px;
  height: ${SORT_ICON_SIZE}px;

  svg {
    width: ${SORT_ICON_SIZE}px;
    height: ${SORT_ICON_SIZE}px;
  }

  ${mediaQuery('small')} {
    width: ${SORT_ICON_SIZE_SMALL}px;
    height: ${SORT_ICON_SIZE_SMALL}px;

    svg {
      width: ${SORT_ICON_SIZE_SMALL}px;
      height: ${SORT_ICON_SIZE_SMALL}px;
    }
  }
`

// Exported like TablePaginationProps beside it: a styled(TableContainer) in
// another module cannot name this type otherwise, and tsc rejects the resulting
// un-nameable inferred type (TS4023).
export interface TableContainerProps {
  $loading?: boolean
}

export const TableContainer = styled.div<TableContainerProps>`
  width: 100%;
  max-width: 100%;
  /* One rounded outer frame for every table, centralized here — the border
     follows the radius and overflow clips the header marble to it, so cells only
     draw internal row dividers (no faked corners / double borders). */
  overflow: hidden;
  border-radius: var(--radius-md);
  border: 1px solid ${({ theme }) => theme.colors.border.base};
`

export const Table = styled.table`
  width: 100%;
  max-width: 100%;
  border-collapse: collapse;
  position: relative;
  z-index: 1;
  table-layout: fixed;
`

export const TableHeader = styled.thead`
  position: sticky;
  top: 0;
  z-index: 2;
`

// The table-header "marble glow" — red glow + a dimmed marble texture layered
// over the card surface. A <tr> can't host the screen-blend ::after wash, so the
// marble is a background image instead. Shared so the card view header can match
// the table-header tops from one source.
export const marbleHeaderBackground = css`
  background: ${({ theme }) => theme.colors.effects.glowRed},
    linear-gradient(rgba(7, 6, 6, 0.62), rgba(7, 6, 6, 0.62)),
    url('${import.meta.env.BASE_URL}design/marble-purple.jpg') center / cover no-repeat,
    ${({ theme }) => theme.colors.background.card};
`

export const HeaderRow = styled.tr`
  ${marbleHeaderBackground}

  th {
    border-bottom: 1px solid ${(props) => props.theme.colors.border.base};
  }
`

export interface HeaderCellProps {
  width?: string
  align?: 'left' | 'center' | 'right'
  sortable?: boolean
  onClick?: () => void
}

export const HeaderCell = styled.th<HeaderCellProps>`
  padding: 16px 20px;
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 12px;
  font-weight: 500;
  color: ${({ theme }) => theme.colors.text.label};
  text-align: ${(props) => props.align || 'left'};
  width: ${(props) => props.width || 'auto'};
  letter-spacing: 0.06em;
  text-transform: uppercase;
  cursor: ${(props) => (props.sortable ? 'pointer' : 'default')};
  user-select: none;
  transition: opacity 0.2s ease;
  overflow: visible;
  box-sizing: border-box;

  &:hover {
    opacity: ${(props) => (props.sortable ? '1' : '0.85')};
  }

  &:first-child {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  &:last-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  ${mediaQuery('small')} {
    /* Horizontal padding matches TableCell (12px) so headers line up with the
       cell content at mobile width (on desktop both already use 20px). */
    padding: 12px 12px;
    font-size: 10px;
    letter-spacing: 0.5px;
  }
`

export const TableRow = styled.tr`
  background: ${(props) => props.theme.colors.background.base};
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: ${(props) => props.theme.colors.background.subtle};
  }

  td {
    border-bottom: 1px solid ${(props) => props.theme.colors.border.base};
  }

  &:last-child td {
    border-bottom: none;
  }

  &:hover td {
    border-color: ${(props) => props.theme.colors.border.medium};
  }
`

export interface TableCellProps {
  width?: string
  align?: 'left' | 'center' | 'right'
}

export const TableCell = styled.td<TableCellProps>`
  padding: 10px 20px;
  text-align: ${(props) => props.align || 'left'};
  width: ${(props) => props.width || 'auto'};
  border: none;
  box-sizing: border-box;

  &:first-child {
    border-top-left-radius: 0;
    border-bottom-left-radius: 0;
  }

  &:last-child {
    border-top-right-radius: 0;
    border-bottom-right-radius: 0;
  }

  ${mediaQuery('small')} {
    padding: 8px 12px;
  }
`

export interface TableLoadMoreProps {
  currentCount: number
  totalCount: number
  hasNextPage: boolean
  isFetchingNextPage: boolean
  onLoadMore: () => void
}

export function TableLoadMore({
  currentCount,
  totalCount,
  hasNextPage,
  isFetchingNextPage,
  onLoadMore,
}: TableLoadMoreProps) {
  if (!hasNextPage) {
    return null
  }

  return (
    <LoadMoreContainer>
      <LoadMoreButton onClick={onLoadMore} disabled={isFetchingNextPage}>
        {isFetchingNextPage ? 'Loading...' : `Load More (${currentCount} of ${totalCount})`}
      </LoadMoreButton>
    </LoadMoreContainer>
  )
}

const LoadMoreContainer = styled.div`
  display: flex;
  justify-content: center;
  margin-top: 24px;
`

const LoadMoreButton = styled.button`
  padding: 12px 32px;
  font-size: 14px;
  font-weight: 500;
  color: ${(props) => props.theme.colors.text.primary};
  background: ${(props) => props.theme.colors.background.subtle};
  border: 1px solid ${(props) => props.theme.colors.border.base};
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: ${(props) => props.theme.colors.primary.soft};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }
`

export interface TablePaginationProps {
  currentPage: number
  totalPages: number
  pageSize: number
  totalItems: number
  onPageChange: (page: number) => void
  isLoading?: boolean
}

export function TablePagination({
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  onPageChange,
  isLoading = false,
}: TablePaginationProps) {
  if (totalItems === 0) {
    return null
  }

  const startItem = (currentPage - 1) * pageSize + 1
  const endItem = Math.min(currentPage * pageSize, totalItems)

  const getPageNumbers = (): (number | 'ellipsis')[] => {
    const pages: (number | 'ellipsis')[] = []
    const maxVisiblePages = 5

    if (totalPages <= maxVisiblePages + 2) {
      for (let i = 1; i <= totalPages; i++) {
        pages.push(i)
      }
    } else {
      pages.push(1)

      if (currentPage > 3) {
        pages.push('ellipsis')
      }

      const start = Math.max(2, currentPage - 1)
      const end = Math.min(totalPages - 1, currentPage + 1)

      for (let i = start; i <= end; i++) {
        pages.push(i)
      }

      if (currentPage < totalPages - 2) {
        pages.push('ellipsis')
      }

      pages.push(totalPages)
    }

    return pages
  }

  const pageNumbers = getPageNumbers()

  return (
    <PaginationWrapper>
      <PaginationInfo>
        Showing {startItem}-{endItem} of {totalItems}
      </PaginationInfo>
      {totalPages > 1 && (
        <PaginationContainer>
          <PaginationButton
            onClick={() => onPageChange(currentPage - 1)}
            disabled={currentPage === 1 || isLoading}
            aria-label='Previous page'
          >
            <ChevronLeftIcon />
          </PaginationButton>

          {pageNumbers.map((page, index) =>
            page === 'ellipsis' ? (
              <PaginationEllipsis key={`ellipsis-${index}`}>...</PaginationEllipsis>
            ) : (
              <PageNumberButton
                key={page}
                onClick={() => onPageChange(page)}
                $active={page === currentPage}
                disabled={isLoading}
              >
                {page}
              </PageNumberButton>
            )
          )}

          <PaginationButton
            onClick={() => onPageChange(currentPage + 1)}
            disabled={currentPage === totalPages || isLoading}
            aria-label='Next page'
          >
            <ChevronRightIcon />
          </PaginationButton>
        </PaginationContainer>
      )}
    </PaginationWrapper>
  )
}

export interface CursorPaginationProps {
  /** 1-based index of the first row shown (for "Showing X–Y of Z"). */
  startItem: number
  /** 1-based index of the last row shown. */
  endItem: number
  totalItems: number
  /** When true, the total is a lower bound (server-capped) — rendered as "N+". */
  totalCapped?: boolean
  hasPrev: boolean
  hasNext: boolean
  onPrev: () => void
  onNext: () => void
  isLoading?: boolean
}

/**
 * Keyset (cursor) pagination control: prev/next only, no jump-to-page-N. Shares
 * the styled primitives with TablePagination (same look) but drives the vault
 * list, which pages forward/back by cursor rather than page number. The
 * "Showing X–Y of Z" range is computed by the caller from its cursor-stack depth
 * and the current page's row count (Z is the exact filtered total from the API).
 */
export function CursorPagination({
  startItem,
  endItem,
  totalItems,
  totalCapped = false,
  hasPrev,
  hasNext,
  onPrev,
  onNext,
  isLoading = false,
}: CursorPaginationProps) {
  if (totalItems === 0) {
    return null
  }

  return (
    <PaginationWrapper>
      <PaginationInfo>
        {/* totalCapped ⇒ server-capped total, rendered as "N+" (e.g. "1000+") */}
        Showing {startItem}-{endItem} of {totalItems}
        {totalCapped ? '+' : ''}
      </PaginationInfo>
      {(hasPrev || hasNext) && (
        <PaginationContainer>
          <PaginationButton
            onClick={onPrev}
            disabled={!hasPrev || isLoading}
            aria-label='Previous page'
          >
            <ChevronLeftIcon />
          </PaginationButton>
          <PaginationButton
            onClick={onNext}
            disabled={!hasNext || isLoading}
            aria-label='Next page'
          >
            <ChevronRightIcon />
          </PaginationButton>
        </PaginationContainer>
      )}
    </PaginationWrapper>
  )
}

const ChevronLeftIcon = () => (
  <svg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path
      d='M10 12L6 8L10 4'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
)

const ChevronRightIcon = () => (
  <svg width='16' height='16' viewBox='0 0 16 16' fill='none' xmlns='http://www.w3.org/2000/svg'>
    <path
      d='M6 4L10 8L6 12'
      stroke='currentColor'
      strokeWidth='2'
      strokeLinecap='round'
      strokeLinejoin='round'
    />
  </svg>
)

const PaginationWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  margin-top: 24px;
`

const PaginationInfo = styled.span`
  font-size: 14px;
  color: ${(props) => props.theme.colors.text.secondary};

  ${mediaQuery('small')} {
    font-size: 13px;
  }
`

const PaginationContainer = styled.div`
  display: flex;
  justify-content: center;
  align-items: center;
  gap: 4px;

  ${mediaQuery('small')} {
    gap: 2px;
  }
`

const PaginationButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  padding: 0;
  font-size: 14px;
  font-weight: 500;
  color: ${(props) => props.theme.colors.text.primary};
  background: ${(props) => props.theme.colors.background.subtle};
  border: 1px solid ${(props) => props.theme.colors.border.base};
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: ${(props) => props.theme.colors.primary.soft};
  }

  &:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  ${mediaQuery('small')} {
    width: 32px;
    height: 32px;
  }
`

interface PageNumberButtonProps {
  $active: boolean
}

const PageNumberButton = styled.button<PageNumberButtonProps>`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  padding: 0 8px;
  font-size: 14px;
  font-weight: ${(props) => (props.$active ? '600' : '500')};
  color: ${(props) =>
    props.$active ? props.theme.colors.primary.base : props.theme.colors.text.primary};
  background: ${(props) => props.theme.colors.background.subtle};
  border: 1px solid
    ${(props) => (props.$active ? props.theme.colors.primary.base : props.theme.colors.border.base)};
  border-radius: var(--radius-xs);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover:not(:disabled) {
    background: ${(props) => props.theme.colors.background.elevated};
    border-color: ${(props) =>
      props.$active ? props.theme.colors.primary.base : props.theme.colors.border.medium};
  }

  &:disabled {
    opacity: 0.6;
    cursor: not-allowed;
  }

  ${mediaQuery('small')} {
    min-width: 32px;
    height: 32px;
    font-size: 13px;
    padding: 0 6px;
  }
`

const PaginationEllipsis = styled.span`
  display: flex;
  align-items: center;
  justify-content: center;
  min-width: 36px;
  height: 36px;
  font-size: 14px;
  color: ${(props) => props.theme.colors.text.secondary};

  ${mediaQuery('small')} {
    min-width: 24px;
    height: 32px;
  }
`
