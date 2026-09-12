import { EXTRA_SMALL_WIDTH, SMALL_WIDTH, MEDIUM_WIDTH } from '../styles'

const MEDIA_TYPES = {
  extraSmall: EXTRA_SMALL_WIDTH,
  small: SMALL_WIDTH,
  medium: MEDIUM_WIDTH,
}

type MediaTypeStrings = keyof typeof MEDIA_TYPES

export function mediaQuery(type: MediaTypeStrings) {
  return `@media (max-width: ${MEDIA_TYPES[type]}px)`
}

export function isExtraSmall() {
  return window.innerWidth <= EXTRA_SMALL_WIDTH
}

export function isMobile() {
  return window.innerWidth <= SMALL_WIDTH
}

export function isMediumScreen() {
  return window.innerWidth <= MEDIUM_WIDTH
}
