import styled from 'styled-components'

interface Props {
  /** 0–100: how much of the token's total capacity is currently deposited. */
  filledPercent: number
  className?: string
}

/**
 * The hairline under the capacity figure: a 3px track whose fill is the share
 * of this token's total fixed capacity that is currently deposited — i.e. the
 * TVL column beside it, as a fraction of the number above it.
 *
 * Deliberately NOT the shared `ProgressBar` — that one is a labelled control
 * with its percentage rendered inside the fill, which at 3px tall has nowhere
 * to put the text. Restyling it into this would mean overriding its height,
 * its label, and its typography, i.e. fighting the component rather than using
 * it. This is a different visual element, so it gets its own small one.
 *
 * Presentational only: `aria-hidden`, because the percentage it depicts is
 * rendered as text right beside it. Announcing a second, redundant meter would
 * make the column twice as long to hear for no added information.
 */
export function CapacityBar({ filledPercent, className }: Props) {
  return (
    <Track className={className} aria-hidden='true'>
      <Fill $percent={filledPercent} />
    </Track>
  )
}

/* Sits inline beside its percentage (see TokenTableRow's CapacityMeter), so it
   takes the row's spare width rather than stacking under a value: no top
   margin, and it flexes instead of being a fixed 120px. */
const Track = styled.span`
  flex: 1;
  min-width: 40px;
  max-width: 120px;
  height: 3px;
  border-radius: 3px;
  overflow: hidden;
  background: ${({ theme }) => theme.colors.border.base};
`

const Fill = styled.span<{ $percent: number }>`
  display: block;
  height: 100%;
  width: ${(props) => props.$percent}%;
  background: ${({ theme }) => theme.colors.primary.saffron};
`
