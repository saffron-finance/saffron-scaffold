/** Resolve an operator-configured navigation target without executable schemes,
 * credentials, or HTTPS-to-HTTP downgrade. External HTTPS links are intentional
 * navigation, not authority for API requests or wallet transactions. */
export function safeNavigationHref(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !value.trim() || value.length > 2048 || /[\u0000-\u0020\u007f]/.test(value)) return fallback
  try {
    const origin = typeof window === 'undefined' ? 'https://build.invalid' : window.location.origin
    const url = new URL(value, origin)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return fallback
    if (new URL(origin).protocol === 'https:' && url.protocol !== 'https:') return fallback
    return value
  } catch { return fallback }
}
