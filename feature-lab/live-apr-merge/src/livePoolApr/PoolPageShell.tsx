import styled from 'styled-components'
import type { ReactNode } from 'react'
import { mediaQuery } from './ui'

/** Consistent card surface with no navigation, router or data dependencies. */
export function PoolPageShell({
  title,
  children,
  compactSurface = false,
  cornerControl,
}: {
  title: ReactNode
  children: ReactNode
  compactSurface?: boolean
  cornerControl?: ReactNode
}) {
  return (
    <Page>
      <Header>
        <Title>{title}</Title>
      </Header>
      <Surface $compact={compactSurface} $hasCorner={Boolean(cornerControl)} data-testid='app-surface'>
        {cornerControl && <CornerControl data-png-exclude>{cornerControl}</CornerControl>}
        {children}
      </Surface>
    </Page>
  )
}
const Page = styled.section`
  width: 100%;
  padding-top: 4px;
`
const Header = styled.header`
  max-width: 760px;
  margin-bottom: 20px;
`
const Title = styled.h1`
  margin: 0;
  color: ${({ theme }) => theme.colors.text.primary};
  font-family: ${({ theme }) => theme.fonts.display};
  font-size: clamp(36px, 5vw, 64px);
  font-weight: 500;
  letter-spacing: -0.04em;
  line-height: 1;
`
const Surface = styled.div<{ $compact: boolean; $hasCorner: boolean }>`
  position: relative;
  ${({ $compact }) => !$compact && 'min-height: 420px;'}
  /* Reserve a control row only for the single-pair view. The export and tiled
     cards keep their compact geometry, and metric labels never hit the button. */
  padding: ${({ $compact, $hasCorner }) => ($hasCorner ? '52px 24px 24px' : $compact ? '20px 24px' : '24px')};
  border: 1px solid ${({ theme }) => theme.colors.border.base};
  border-radius: var(--radius-md);
  background: ${({ theme }) => theme.colors.background.card};
  ${mediaQuery('small')} {
    ${({ $compact, $hasCorner }) => !$compact && `min-height: 320px; padding: ${$hasCorner ? '52px 16px 16px' : '16px'};`}
  }
`

const CornerControl = styled.div`
  position: absolute;
  top: 8px;
  right: 8px;
  display: flex;
`
