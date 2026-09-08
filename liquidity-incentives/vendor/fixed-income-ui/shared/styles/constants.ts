import { css } from 'styled-components'

import { hexToRgbString } from './utils'

export const CSS_TRANSITION = 'transition: 0.4s;'

// The hover for every already-red (solid brand-fill) button — the base Button
// and any standalone `styled.button` that renders red without extending Button
// (hamburger, reset, swap, etc.). A single dim so they all react identically.
// Dark controls that should FILL red instead opt into DROPDOWN_TRIGGER_HOVER.
/**
 * Button label typography — one source for every button-sized control.
 *
 * Exists because ModalCancelButton hand-rolled its own (14px / 0.5px) while
 * ModalConfirmButton inherited Button's (16px / 1px / 600), so the two halves
 * of every confirm dialog rendered their labels at visibly different sizes
 * despite sitting side by side. Re-declaring these per component is how that
 * drift happened; use this instead.
 */
export const BUTTON_TYPOGRAPHY = css`
  font-size: 16px;
  letter-spacing: 1px;
  font-weight: 600;
  text-transform: uppercase;
`

export const SOLID_BUTTON_HOVER = css`
  &:hover {
    opacity: 0.6;
  }
`

// The shared typography for every primary red action/CTA button — deposit,
// withdraw, approve, claim, connect, switch-network, earn, confirm, sign.
// Mono caps at 14px, in ONE place so these siblings never drift apart. Each
// button still owns its own layout (width/padding/height) and hover; only the
// type comes from here.
export const ACTION_BUTTON_TYPOGRAPHY = css`
  font-family: ${(props) => props.theme.fonts.mono};
  font-size: 14px;
  font-weight: 500;
  letter-spacing: 0.05em;
  text-transform: uppercase;
`

// The terminal "already done" look for a spent action button — a collected
// vault's earnings, a withdrawn LP position, a claimed premium. The action can
// never be taken again, so the button drops the red call-to-action entirely and
// reads as a neutral marker instead of a faded-out CTA the user keeps pressing.
// Apply behind a `$complete` prop; reversible actions (an early withdrawal, the
// user can deposit again) must NOT use it.
export const COMPLETED_BUTTON = css`
  background: ${(props) => props.theme.colors.background.tertiary};
  border: 1px solid ${(props) => props.theme.colors.border.base};
  color: ${(props) => props.theme.colors.text.tertiary};

  &:disabled {
    background: ${(props) => props.theme.colors.background.tertiary};
    color: ${(props) => props.theme.colors.text.tertiary};
    opacity: 1;
    cursor: default;
  }
`

// The single hover for every interactive control — dropdown/select triggers,
// preset & segmented buttons, open menu options, filter options, and icon
// buttons. A soft translucent brand-red wash (40% over the dark surface), so
// the control highlights without a shouty solid fill. Set it on the control.
export const DROPDOWN_TRIGGER_HOVER = css`
  &:hover {
    background-color: ${(props) => hexToRgbString(props.theme.colors.primary.base, 0.4)};
    /* Reset the base Button's dim so the wash reads on its own, not stacked
       with a 0.6 opacity. Harmless on non-Button controls. */
    opacity: 1;
  }
`

/**
 * The look of a primary action: red fill, white label, the shared hover and
 * press. Everything a primary button IS, minus how big it is — the base
 * `Button` pins a fixed slab, while an inline one (an empty state's way out)
 * sizes to its label.
 *
 * A mixin rather than a component so the same surface can be worn by a real
 * <button> AND by a react-router <Link>. A navigating action has to stay an
 * anchor — a <button> silently breaks ⌘-click, middle-click and "open in new
 * tab" — but it should still look like every other primary action, and that
 * look needs exactly one definition.
 */
export const PRIMARY_BUTTON_SURFACE = css`
  ${CSS_TRANSITION}

  color: #ffffff;
  background-color: ${(props) => props.theme.colors.primary.base};
  cursor: pointer;
  pointer-events: auto;
  &:hover ::before {
    opacity: 1;
  }
  &:active {
    transform: scale(0.98);
  }
  /* One rule for every button: dim on hover. The base bg is red, so this reads
     as the "already-red" hover. Dark controls that should FILL red on hover
     (token selector, range toggle, dropdown triggers) opt into
     DROPDOWN_TRIGGER_HOVER, which resets opacity to 1 and paints the fill. */
  ${SOLID_BUTTON_HOVER}

  border: none;
  border-radius: var(--radius-xs);
  ${BUTTON_TYPOGRAPHY}
`

// Icon buttons (chain selector, account-modal actions, etc.) share the same
// hover — kept as a named alias so those call sites read semantically.
export const ICON_BUTTON_HOVER = DROPDOWN_TRIGGER_HOVER

/**
 * Chrome for the nav bar's outlined icon buttons — the chain selector and the
 * stars badge — minus width.
 *
 * One definition because they sit side by side: drift in height, radius or
 * border shows up as a visibly misaligned row, and these were previously two
 * separate 44px/radius-xs blocks that merely happened to agree. Design values:
 * 40px tall, 4px radius, the signature RED hairline over the transparent nav
 * (not the neutral border.strong these used before), gold on hover.
 *
 * Width is deliberately left out. The chain selector is a true square
 * (NAV_SQUARE_BUTTON below); the stars badge has to grow for its count, and
 * making it override a fixed width would be exactly the "fight the shared
 * component" pattern this split avoids.
 */
export const NAV_BUTTON_CHROME = css`
  height: 40px;
  box-sizing: border-box;
  border-radius: var(--radius-md);
  border: 1px solid ${(props) => props.theme.colors.border.redHairline};
  background-color: transparent;

  &:hover {
    border-color: ${(props) => props.theme.colors.accent.gold};
  }
`

/** NAV_BUTTON_CHROME at a fixed 40px square. */
export const NAV_SQUARE_BUTTON = css`
  ${NAV_BUTTON_CHROME}
  width: 40px;
  flex: none;
`

// Faint marble-texture wash — the design's vault-detail / featured "marble glow":
// a screen-blended overlay so the purple/red veins subtly light up a card without
// obscuring content. Apply alongside the effects.glowRed background on a card.
export const MARBLE_WASH = `
  position: relative;

  &::after {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: inherit;
    background: url(/design/marble-purple.jpg) center / cover no-repeat;
    opacity: 0.1;
    mix-blend-mode: screen;
    pointer-events: none;
  }
`
// The app's custom scrollbar for any bounded, internally-scrolling surface
// (accordion bodies, the token-select list, dropdowns). A slim thumb over a
// faint track so a long list scrolls without the chunky default OS scrollbar.
// Apply to the element that actually scrolls (the one with overflow: auto).
export const CUSTOM_SCROLLBAR = css`
  &::-webkit-scrollbar {
    width: 8px;
  }

  &::-webkit-scrollbar-track {
    background: rgba(0, 0, 0, 0.2);
  }

  &::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: var(--radius-md);
  }

  &::-webkit-scrollbar-thumb:hover {
    background: #666;
  }
`

/**
 * For an element whose extra detail is revealed by a LONG press on touch (see
 * useHoverReveal). Holding a finger on text otherwise fires the OS selection
 * callout — the magnifier and the Copy/Look Up bar — which lands on top of the
 * thing the press was meant to reveal.
 *
 * Scoped to hover-less pointers so a mouse can still select the text.
 */
export const LONG_PRESS_TRIGGER = css`
  @media (hover: none) {
    -webkit-touch-callout: none;
    user-select: none;
  }
`

export const EXTRA_SMALL_WIDTH = 500
export const SMALL_WIDTH = 800
export const MEDIUM_WIDTH = 1300
export const SAFFRON_RED_HEX = '#C44536'
