import styled from 'styled-components'
import { Button } from '../host/ui'

/** Feature-only composition. Colors/type/control dimensions stay upstream-owned. */
export const Stack = styled.div`display:flex;flex-direction:column;gap:20px;min-width:0;overflow-wrap:anywhere;`
export const Row = styled.div`display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;`
export const Token = styled.span`display:inline-flex;align-items:center;gap:10px;min-width:0;`
export const Muted = styled.span`color:${({ theme }) => theme.colors.text.tertiary};font-size:13px;`
export const Label = styled.div`font-family:${({ theme }) => theme.fonts.mono};font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:${({ theme }) => theme.colors.text.label};`
export const Premium = styled.b`color:${({ theme }) => theme.colors.accent.gold};font-weight:500;`
export const Action = styled(Button)`width:100%;flex-shrink:0;`
export const QuietButton = styled.button`
  border:1px solid transparent;border-radius:var(--radius-md);background:${({ theme }) => theme.colors.background.base};
  color:${({ theme }) => theme.colors.text.secondary};padding:9px 12px;cursor:pointer;font-size:12px;
  &:hover:not(:disabled){border-color:${({ theme }) => theme.colors.accent.gold}} &:disabled{opacity:.5;cursor:default}
  &:focus-visible{outline:2px solid ${({ theme }) => theme.colors.accent.gold};outline-offset:2px;}
`
export const ErrorText = styled.p`font-size:13px;line-height:1.5;color:${({ theme }) => theme.colors.semantic.error};margin:0;overflow-wrap:anywhere;`
export const Disclosure = styled.details`
  border:1px solid transparent;border-radius:var(--radius-md);padding:12px 14px;font-size:13px;
  summary{cursor:pointer;color:${({ theme }) => theme.colors.text.secondary};font-weight:500}
  p{line-height:1.5}
`
export const FinePrint = styled.p`font-size:12px;line-height:1.5;color:${({ theme }) => theme.colors.text.tertiary};margin:0;`
