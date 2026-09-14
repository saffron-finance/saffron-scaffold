import { defineConfig } from 'vite'
import config from './walletconnect.vite'

/** Test-only peer; real application chunks, AppKit, logo and PNG modules. Like
 * the existing wallet fixture build, it deliberately has no release marker. */
export default defineConfig(async env => {
  const source = await (config as Function)({ ...env, mode: 'lab' })
  return { ...source, base: '/download-test/',
    define: { ...source.define, 'import.meta.env.VITE_WALLETCONNECT_PROJECT_ID': JSON.stringify('a'.repeat(32)) },
    build: { ...source.build, outDir: 'validation/downloads-build' } }
})
