/** FI's USD capacity uses integer cents. Never round a signed deposit. */
export function depositCents(value) {
  if (typeof value !== 'string' || value.length > 50 || !/^\d+(\.\d+)?$/.test(value)) return null
  const [whole, fraction = ''] = value.split('.')
  if (/[1-9]/.test(fraction.slice(2))) return null
  const cents = BigInt(whole) * 100n + BigInt(fraction.slice(0, 2).padEnd(2, '0'))
  return cents > 0n && cents <= 100_000_000_000_000n ? cents.toString() : null
}
