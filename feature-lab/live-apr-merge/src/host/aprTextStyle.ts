import styled, { css } from 'styled-components'

// Share only APR paint. Consumers keep their own font, weight and dimensions.
export { aprTextGradient } from './aprGradient'
import { aprTextGradient } from './aprGradient'
export const aprTextPaint = css`
  background-image:${aprTextGradient};
  -webkit-background-clip:text;background-clip:text;color:transparent;
`

/** A separate marker opts navigation text into APR motion without treating it
 * as a numeric metric or inheriting the table's typography overrides. */
export const AprNavigationLabel = styled.span.attrs({ 'data-apr-navigation': '' })`${aprTextPaint}`
