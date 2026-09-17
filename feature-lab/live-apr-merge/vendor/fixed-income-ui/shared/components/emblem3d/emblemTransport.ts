import { Texture } from 'three'

/** Fetch one owner-scoped decorative asset. Three's global FileLoader cache
 * can merge requests from different scene owners; native fetch retains browser
 * caching while giving each consumer its own cancellation boundary. */
export async function loadEmblemBytes(url: string, signal: AbortSignal): Promise<ArrayBuffer> {
  const response = await fetch(url, { signal, credentials: 'same-origin', redirect: 'error' })
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
  try {
    if (!response.ok || !response.body || Number(response.headers.get('content-length')) > 4_000_000)
      throw new Error('Decorative asset unavailable')
    reader = response.body.getReader()
    let size = 0
    const chunks: Uint8Array[] = []
    while (true) {
      signal.throwIfAborted()
      const part = await reader.read()
      if (part.done) break
      size += part.value.byteLength
      if (size > 4_000_000) throw new Error('Decorative asset too large')
      chunks.push(part.value)
    }
    signal.throwIfAborted()
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    return bytes.buffer
  } finally {
    if (reader) { await reader.cancel().catch(() => {}); reader.releaseLock() }
    else await response.body?.cancel().catch(() => {})
  }
}

/** Decode only downloaded bytes, so unmount/timeout cancels the actual network
 * request rather than merely abandoning a TextureLoader callback. ImageBitmap
 * ignores Texture.flipY, so request the equivalent orientation during decode. */
export async function loadEmblemTexture(url: string, signal: AbortSignal): Promise<Texture> {
  const bytes = await loadEmblemBytes(url, signal)
  const bitmap = await createImageBitmap(new Blob([bytes]), { imageOrientation: 'flipY', premultiplyAlpha: 'none' })
  if (signal.aborted) { bitmap.close(); signal.throwIfAborted() }
  const texture = new Texture(bitmap)
  texture.needsUpdate = true
  // GPU disposal does not close ImageBitmap's separately owned CPU storage.
  texture.addEventListener('dispose', () => bitmap.close())
  return texture
}
