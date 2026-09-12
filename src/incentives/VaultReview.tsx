import type { ReactNode } from 'react'
import styled from 'styled-components'
import { Disclosure } from './styles'

/** The same page-two review body in both deployment and position modes.
 * Controllers own wallet actions; the presentational component never submits.
 */
export function VaultReview({ bullets, details, label = 'Vault terms' }:
  { bullets: ReactNode; details: ReactNode; label?: string }) {
  return <>
    <Bullets>{bullets}</Bullets>
    <Disclosure aria-label={label}><summary><SummaryLabel>Details</SummaryLabel></summary>{details}</Disclosure>
  </>
}

const Bullets = styled.ul`display:flex;flex-direction:column;gap:3px;padding-left:17px;margin:0;font-size:13px;line-height:1.6;li::marker{color:${({ theme }) => theme.colors.semantic.success}}`
// The native disclosure marker remains keyboard-accessible; give its label a
// visible space that does not depend on collapsed HTML whitespace handling.
const SummaryLabel=styled.span`padding-left:.35em;`
