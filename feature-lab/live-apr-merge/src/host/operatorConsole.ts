/** Optional operator-console location. The sibling default follows the app's
 * build base, so exported frontend code contains no production host or mount. */
export const operatorConsoleHref = import.meta.env.VITE_OPERATOR_CONSOLE_HREF ||
  new URL('../server-operator/', new URL(import.meta.env.BASE_URL, window.location.origin)).pathname
