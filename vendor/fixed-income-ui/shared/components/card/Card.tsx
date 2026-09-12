import styled, { css } from 'styled-components'

import { CSS_TRANSITION, hexToRgbString } from '../../styles'

export const Card = styled.div<{ opacityOnHover?: boolean }>`
  ${CSS_TRANSITION}
  background-color: ${({ theme }) => theme.colors.background.card};
  border: 1px solid ${({ theme }) => theme.colors.border.base};
  width: 100%;
  border-radius: var(--radius-md);
  ${(props) =>
    props.opacityOnHover &&
    css`
      &:hover {
        background-color: ${(props) =>
          hexToRgbString(props.theme.colors.background.base, 0.6)};
      }
    `}
`
