import styled, { css } from 'styled-components'

/** Portable presentation primitives matching fixed-income. No wallet, token-list,
 * host-wide style barrel, or data hook is pulled into the APR import graph. */
export function mediaQuery(type: 'extraSmall' | 'small' | 'medium') {
  return `@media (max-width: ${{ extraSmall: 500, small: 800, medium: 1300 }[type]}px)`
}

export const DropdownMenu = styled.div`
  position: absolute;
  top: calc(100% + 4px);
  left: 0;
  width: 100%;
  z-index: 100;
  display: flex;
  flex-direction: column;
  padding: 4px;
  gap: 2px;
  background-color: ${(props) => props.theme.colors.background.base};
  border: 1px solid ${(props) => props.theme.colors.border.base};
  border-radius: var(--radius-sm);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  /* Cap the height and scroll long option lists (e.g. many weeks) so the menu
     never runs off the page / behind the fixed bottom nav. */
  max-height: min(320px, 60vh);
  overflow-y: auto;
`

/**
 * One menu row's appearance, as a css block so it can dress an element other
 * than the <button> below — a menu whose rows NAVIGATE renders them as router
 * links instead (see the nav's ExploreMenu), which is what keeps ⌘-click,
 * middle-click and "open in new tab" working on them.
 */
export const DROPDOWN_MENU_ITEM = css<{ $active: boolean }>`
  display: flex;
  align-items: center;
  width: 100%;
  box-sizing: border-box;
  text-align: left;
  text-decoration: none;
  padding: 8px 10px;
  border: none;
  border-radius: var(--radius-xs);
  cursor: pointer;
  font-family: ${(props) => props.theme.fonts.mono};
  font-size: 13px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  background-color: ${(props) =>
    props.$active ? props.theme.colors.primary.soft : 'transparent'};
  /* An anchor colours its own :visited state, so the row's text colour has to
     be stated for it too or a followed link turns purple. */
  &,
  &:visited {
    color: ${(props) => props.theme.colors.text.primary};
  }

  /* Match the trigger's hover — solid red fill + light text — so an open menu
     option highlights the same way as the control that opened it. */
  &:hover { background-color: color-mix(in srgb, ${({ theme }) => theme.colors.primary.base} 40%, transparent); opacity: 1; }
`
