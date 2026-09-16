/** Read a small APR control response without first buffering an unlimited body.
 * Cancellation releases the stream reader on oversize, timeout, and unmount. */
export async function boundedControlText(response: Response, signal: AbortSignal, limit = 32_768): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let bytes = 0, text = ''
  const abort = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', abort, { once: true })
  try {
    signal.throwIfAborted()
    while (true) {
      const part = await reader.read()
      signal.throwIfAborted()
      if (part.done) return text + decoder.decode()
      bytes += part.value.byteLength
      if (bytes > limit) throw new Error('Oversized control response')
      text += decoder.decode(part.value, { stream: true })
    }
  } finally {
    signal.removeEventListener('abort', abort)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
