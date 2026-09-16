/** Wire milliseconds must fit JavaScript Date, not merely a safe integer. */
export function validTimestamp(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 8_640_000_000_000_000
}

/** Last-resort presentation guard for old cached or directly supplied values. */
export function formatTimestamp(value: unknown, clockOnly = false): string {
  if (!validTimestamp(value)) return 'Unavailable'
  const iso = new Date(value).toISOString()
  return clockOnly ? iso.slice(11, 19) : iso
}
