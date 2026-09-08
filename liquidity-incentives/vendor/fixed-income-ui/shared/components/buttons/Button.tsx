import styled from 'styled-components'

import { PRIMARY_BUTTON_SURFACE, hexToRgbString } from '../../styles'
import { LoadingShimmerStyles } from '../Loading'

export const Button = styled.button<{
  disabled?: boolean
  loading?: boolean
}>`
  ${PRIMARY_BUTTON_SURFACE}

  width: 162px;
  height: 47px;

  ${(props) =>
    props.disabled &&
    `
    color: #FFFFFF;
    background-color: ${props.theme.colors.primary.base};
    cursor: not-allowed;
    pointer-events: none;
    opacity: 0.5;
    `}

  ${(props) =>
    props.loading &&
    `
      color: ${hexToRgbString(props.theme.colors.text.tertiary, 0.75)};
      ${LoadingShimmerStyles}
    `}
`
