import { expect, it } from 'vitest'
import { boundedControlText } from './bounded-response'

it('cancels an oversized response before consuming the rest of its body', async () => {
  let reads = 0, cancelled = false
  const body = new ReadableStream<Uint8Array>({
    pull(controller) { reads++; controller.enqueue(new Uint8Array(4096)) },
    cancel() { cancelled = true },
  })
  await expect(boundedControlText(new Response(body), new AbortController().signal)).rejects.toThrow('Oversized')
  expect(reads).toBeLessThanOrEqual(10)
  expect(cancelled).toBe(true)
})

it('releases a stalled response when its owner aborts', async () => {
  let cancelled = false
  const controller = new AbortController()
  const reading = boundedControlText(new Response(new ReadableStream({ cancel() { cancelled = true } })), controller.signal)
  controller.abort()
  await expect(reading).rejects.toThrow()
  expect(cancelled).toBe(true)
})

it('decodes split UTF-8 within the exact byte ceiling', async () => {
  const bytes = new TextEncoder().encode('{"label":"香"}')
  const body = new ReadableStream<Uint8Array>({ start(channel) {
    for (const byte of bytes) channel.enqueue(new Uint8Array([byte]))
    channel.close()
  } })
  expect(await boundedControlText(new Response(body), new AbortController().signal, bytes.length)).toBe('{"label":"香"}')
})
