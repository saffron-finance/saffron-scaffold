import type { ZapQuote, ZapQuoteRequest } from './types'

const RETRY_DELAYS_MS = [0, 900, 2_000]

/** Preserve whether an HTTP failure is safe to retry inside the short quote loop. */
class ZapQuoteHttpError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message)
    this.name = 'ZapQuoteHttpError'
  }
}

function quoteEndpoint(): string {
  // `document.baseURI` preserves either a root deployment or LiqiFi's nested
  // reverse-proxy prefix without exposing a configurable external API origin.
  return new URL('zaps/quote', document.baseURI).toString()
}

function errorMessage(payload: unknown, fallback: string): string {
  if (!payload || typeof payload !== 'object') return fallback
  const value = payload as { error?: unknown; details?: unknown }
  if (typeof value.details === 'string') return value.details.slice(0, 180)
  if (typeof value.error === 'string') return value.error.slice(0, 180)
  return fallback
}

function isRetryableResponse(payload: unknown, status: number): boolean {
  if (payload && typeof payload === 'object') {
    const retryable = (payload as { retryable?: unknown }).retryable
    if (typeof retryable === 'boolean') return retryable
  }
  return [404, 429, 502, 503, 504].includes(status)
}

/** Request one bounded same-origin quote, with short retries for LI.FI flakiness. */
export async function requestZapQuote(request: ZapQuoteRequest): Promise<ZapQuote> {
  let lastError: Error | undefined
  for (const delay of RETRY_DELAYS_MS) {
    if (delay) await new Promise((resolve) => window.setTimeout(resolve, delay))
    const controller = new AbortController()
    const timeout = window.setTimeout(() => controller.abort(), 25_000)
    try {
      const response = await fetch(quoteEndpoint(), {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(request),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) {
        const error = new ZapQuoteHttpError(
          errorMessage(payload, `Zap quote failed (HTTP ${response.status})`),
          isRetryableResponse(payload, response.status),
        )
        if (!error.retryable) throw error
        lastError = error
        continue
      }
      const quote = (payload as { data?: ZapQuote } | null)?.data
      if (!quote?.transactionRequest?.to || !quote.transactionRequest.data) {
        throw new Error('LI.FI returned an incomplete transaction request')
      }
      return quote
    } catch (error) {
      // Validation failures and other non-retryable 4xx responses should reach
      // the user immediately instead of making the same request three times.
      if (error instanceof ZapQuoteHttpError && !error.retryable) throw error
      if ((error as Error).name === 'AbortError') lastError = new Error('LI.FI quote timed out')
      else lastError = error as Error
    } finally {
      window.clearTimeout(timeout)
    }
  }
  throw lastError ?? new Error('No LI.FI route is available')
}
