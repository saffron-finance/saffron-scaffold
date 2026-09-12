import { css } from 'styled-components'

/** Shared quiet surface for vault rows and account-header controls. Geometry,
 * typography and click behavior belong to each consumer; only the gray paint,
 * gold hover border and keyboard outline are shared here. */
export const rowSurface = css`
  border:1px solid #1d1d1d;border-radius:var(--radius-md);
  background:#0a0a0a;transition:border-color .16s ease;
  &:hover{border-color:${({theme})=>theme.colors.accent.gold}}
  &:focus-visible{outline:2px solid ${({theme})=>theme.colors.accent.gold};outline-offset:4px}
`
