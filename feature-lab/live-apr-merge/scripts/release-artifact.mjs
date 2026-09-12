import assert from 'node:assert/strict'
import { readFileSync, readdirSync, writeFileSync, lstatSync } from 'node:fs'
import { resolve } from 'node:path'
import { sha256 } from './release-source.mjs'

export const safeFile = name => typeof name === 'string' && /^[a-zA-Z0-9_.@/-]+$/.test(name)
  && !name.startsWith('/') && name.split('/').every(part => part && part !== '.' && part !== '..')
export function mountPath(base) {
  if (!base.endsWith('/')) base += '/'
  assert(base === '/' || (base.startsWith('/') && safeFile(base.slice(1, -1))), 'Use an absolute root or nested mount path')
  return base
}
const digestFiles = files => sha256(Object.keys(files).sort().map(name => name + '\0' + files[name] + '\n').join(''))

/** Run after Vite writes HTML, its manifest and every lazy asset. The marker
 * binds their bytes to source identity; it is not a cryptographic signature. */
export function writeReleaseMarker(directory, mode) {
  const files = {}
  function visit(prefix = '') {
    for (const name of readdirSync(resolve(directory, prefix)).sort()) {
      const key = prefix + name
      if (key === 'deployment-mode.json' || name.endsWith('.zip')) continue
      assert(safeFile(key), 'Unsupported release asset path')
      const path = resolve(directory, key), info = lstatSync(path)
      assert(!info.isSymbolicLink(), 'Release assets cannot be links')
      if (info.isDirectory()) visit(key + '/')
      else files[key] = sha256(readFileSync(path))
    }
  }
  visit()
  assert(files['index.html'] && files['.vite/manifest.json'], 'Vite output is incomplete')
  const marker = { schema: 1, application: 'saffron-liquidity-incentives', ...mode,
    basePath: mountPath(mode.basePath), files, assetDigest: digestFiles(files) }
  writeFileSync(resolve(directory, 'deployment-mode.json'), JSON.stringify(marker, null, 2) + '\n')
  return marker
}

export function validateMarker(marker, { basePath, requireClean = true, expectedRelease, expectedMode = 'canonical-api' } = {}) {
  assert.equal(marker.schema, 1, 'Unsupported release marker')
  assert.equal(marker.application, 'saffron-liquidity-incentives', 'Wrong public interface')
  assert.equal(marker.incentives, expectedMode, 'Wrong incentive adapter')
  assert.equal(marker.wallet, expectedMode === 'canonical-api', 'Wallet/adapter mismatch')
  assert.equal(typeof marker.appearanceControls, 'boolean')
  assert.equal(marker.basePath, mountPath(basePath), 'Wrong release mount')
  assert.equal(marker.release?.package, 'saffron-live-apr-merge')
  assert.match(marker.release.version, /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/)
  assert.match(marker.release.sourceDigest, /^[0-9a-f]{64}$/)
  if (requireClean) {
    assert.match(marker.release.revision ?? '', /^[0-9a-f]{40}$/)
    assert.equal(marker.release.dirty, false, 'Release must come from committed, unchanged source')
  }
  if (expectedRelease) assert.deepEqual(marker.release, expectedRelease, 'Served release differs from the approved source manifest')
  const paths = Object.keys(marker.files ?? {})
  assert(paths.length > 2 && paths.length <= 2048 && paths.every(safeFile), 'Invalid release asset inventory')
  assert(marker.files['index.html'] && marker.files['.vite/manifest.json'], 'Missing entry or asset manifest')
  assert(paths.every(path => /^[0-9a-f]{64}$/.test(marker.files[path])), 'Invalid asset hash')
  assert.equal(marker.assetDigest, digestFiles(marker.files), 'Asset inventory identity differs')
}

/** request() is injectable for an existing hosting-auth session. No credentials
 * are written to the release evidence. Concurrency stays bounded for the host. */
export async function verifyRelease(target, { request = (path) => fetch(new URL(path, target), {
  redirect: 'error', signal: AbortSignal.timeout(25000), cache: 'no-store',
}), ...options } = {}) {
  target = new URL(target)
  async function read(path) {
    const response = await request(path)
    assert.equal(response.status, 200, path + ' must return HTTP 200')
    return { data: Buffer.from(await response.arrayBuffer()), type: response.headers.get('content-type') ?? '' }
  }
  const header = await read('deployment-mode.json')
  assert.match(header.type, /application\/json/, 'Release marker must not return SPA HTML')
  const marker = JSON.parse(header.data.toString())
  validateMarker(marker, { basePath: target.pathname, ...options })
  const paths = Object.keys(marker.files), documents = new Map()
  let cursor = 0
  await Promise.all(Array.from({ length: Math.min(4, paths.length) }, async () => {
    for (;;) {
      const path = paths[cursor++]
      if (!path) return
      const { data, type } = await read(path)
      assert.equal(sha256(data), marker.files[path], 'Served asset differs: ' + path)
      if (/\.(js|css|json)$/.test(path)) assert(!/text\/html/i.test(type), path + ' must not return HTML')
      if (path === 'index.html') assert.match(type, /text\/html/, 'Entry must be HTML')
      if (path === 'index.html' || path === '.vite/manifest.json') documents.set(path, data.toString())
    }
  }))
  const index = documents.get('index.html'), manifest = JSON.parse(documents.get('.vite/manifest.json'))
  assert(manifest['index.html']?.isEntry, 'Asset manifest must identify the entry')
  // Both immediate and lazy chunks must belong to this release. Also catch an
  // entry document that points at another mount or to an unlisted old chunk.
  for (const item of Object.values(manifest)) {
    for (const path of [item.file, ...(item.css ?? []), ...(item.assets ?? [])])
      assert(safeFile(path) && marker.files[path], 'Asset manifest references an unlisted file')
    for (const key of [...(item.imports ?? []), ...(item.dynamicImports ?? [])]) assert(manifest[key], 'Asset manifest has a missing import')
  }
  const scripts = [...index.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)].map(match => match[1])
  const styles = [...index.matchAll(/<link\b(?=[^>]*\brel=["'](?:stylesheet|modulepreload)["'])[^>]*\bhref=["']([^"']+)["']/gi)].map(match => match[1])
  assert(scripts.length, 'Entry has no application script')
  const entries = [...scripts, ...styles].map(path => {
    const url = new URL(path, target)
    assert(url.origin === target.origin && url.pathname.startsWith(target.pathname) && !url.search && !url.hash, 'Entry asset uses the wrong mount')
    const relative = url.pathname.slice(target.pathname.length)
    assert(marker.files[relative], 'Entry references an unlisted asset')
    return relative
  })
  assert(entries.includes(manifest['index.html'].file), 'HTML and asset manifest use different entries')
  // A proxy may serve a different index at the mount root than /index.html.
  assert.equal(sha256((await read('')).data), marker.files['index.html'], 'Mounted entry differs from index.html')
  return marker
}
