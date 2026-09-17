import { safeNavigationHref } from './safeNavigation'
/** Console hosting remains portable; unsafe config falls back to the sibling. */
const fallback = new URL('../server-operator/', new URL(import.meta.env.BASE_URL, window.location.origin)).pathname
export const operatorConsoleHref = safeNavigationHref(import.meta.env.VITE_OPERATOR_CONSOLE_HREF, fallback)
