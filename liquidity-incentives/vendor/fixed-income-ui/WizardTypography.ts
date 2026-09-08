import styled from 'styled-components'
import { mediaQuery } from './shared/utils/mediaQuery'
export const StepTitle = styled.h1`
  margin: 6px 0 0;
  font-family: ${(p) => p.theme.fonts.display};
  font-weight: 400;
  font-size: 44px;
  line-height: 1.1;
  color: ${(p) => p.theme.colors.text.primary};

  ${mediaQuery('small')} {
    margin-top: 0;
    font-size: 32px;
  }
`
export const StepSubtitle = styled.p`
  margin: 0;
  font-size: 15px;
  color: ${(p) => p.theme.colors.text.tertiary};
`