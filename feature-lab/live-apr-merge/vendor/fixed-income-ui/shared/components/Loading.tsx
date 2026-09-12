import styled, { css } from 'styled-components'

import ellipsisLoader from '../assets/images/ellipsis-loader.svg?url'
import { StylingProps } from '../styles'

export function Loading({ className }: StylingProps) {
  return (
    <Loader className={className}>
      <img alt='Loading' src={ellipsisLoader} />
    </Loader>
  )
}

const Loader = styled.div`
  width: 100px;
  margin: 100px auto 0;
  text-align: center;

  img {
    width: 100%;
  }
`

export const LoadingShimmerStyles = css`
  @keyframes shimmer {
    from {
      opacity: 0.4;
    }
    to {
      opacity: 1;
    }
  }
  animation: shimmer 0.8s linear infinite alternate;
`
