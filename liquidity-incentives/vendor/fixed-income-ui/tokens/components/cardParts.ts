import styled from 'styled-components'

/**
 * Shared internals of a token card — the icon-beside-content row used by both
 * the Tokens page's featured strip (FeaturedTokenCards) and the pairs page's
 * card list (PairTokenCards). One source of truth: the two strips previously
 * duplicated these blocks and drifted.
 *
 * Layout is two ROWS, not two columns, so each line gives its space to the
 * text that needs it:
 *   row 1: symbol …… APR range   — the range stays on one line (it shares the
 *          row only with a short symbol, which truncates first if ever squeezed)
 *   row 2: capacity phrase …… "APR" label — the phrase gets nearly the full
 *          width ("$21K available" never ellipsizes against a 3-char label)
 *
 * The old column layout made one SIDE win per card, which either truncated the
 * capacity phrase or wrapped the APR range mid-"to".
 */

export const Body = styled.div`
  flex: 1;
  min-width: 0;
`

export const Row = styled.div`
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px;

  & + & {
    margin-top: 4px;
  }
`

export const Symbol = styled.div`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-weight: 500;
  font-size: 15px;
  letter-spacing: 0.04em;
  color: ${({ theme }) => theme.colors.text.primary};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const CapacityLine = styled.div`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 11px;
  letter-spacing: 0.06em;
  color: ${({ theme }) => theme.colors.text.secondary};
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
`

export const AprValue = styled.div`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-weight: 500;
  font-size: 15px;
  color: ${({ theme }) => theme.colors.accent.gold};
  font-variant-numeric: tabular-nums;
  /* The range owns its row's slack (the symbol beside it truncates first), so
     it never needs to wrap mid-"to". */
  flex: none;
  white-space: nowrap;
`

export const AprLabel = styled.div`
  font-family: ${({ theme }) => theme.fonts.mono};
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: ${({ theme }) => theme.colors.text.label};
  flex: none;
`
