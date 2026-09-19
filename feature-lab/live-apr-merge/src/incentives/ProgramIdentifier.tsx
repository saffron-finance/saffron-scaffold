import {programReference} from './program-language'
import styled from 'styled-components'

/** Show the complete persisted program ID, never a list index or shortened hash.
 * Requests retain this identity even when their campaign is edited or removed.
 * Missing legacy data stays explicit instead of guessing from a pair or budget.
 */
export function ProgramIdentifier({id}:{id?:string|null}){
  return <Identifier data-program-reference={id || undefined}>Program ID: <code>{programReference(id)}</code></Identifier>
}

// Full IDs remain selectable and wrap on narrow screens without truncation.
const Identifier=styled.span`
  display:block;min-width:0;margin-top:6px;overflow-wrap:anywhere;
  color:${p=>p.theme.colors.text.secondary};font:400 12px/1.6 ${p=>p.theme.fonts.body};
  code{font-family:${p=>p.theme.fonts.mono};user-select:text}
`
