// A tiny shared store so every instance of a token symbol shows the SAME icon. The first instance
// that successfully loads a real logo (from any chain) records it here; all other instances — and any
// later re-render — then use that exact URL. Tokens no source ever resolves fall back to the (also
// deterministic) monogram, so a given token is always rendered identically.
const cache = new Map<string, string>() // SYMBOL (upper) → resolved logo url
const listeners = new Set<() => void>()

export function getLogo(symbol: string): string | undefined {
  return cache.get(symbol.toUpperCase())
}

export function setLogo(symbol: string, url: string): void {
  const key = symbol.toUpperCase()
  if (cache.get(key) === url) return
  cache.set(key, url)
  for (const l of listeners) l()
}

export function subscribeLogos(l: () => void): () => void {
  listeners.add(l)
  return () => listeners.delete(l)
}
