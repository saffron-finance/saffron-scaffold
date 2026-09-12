import { defineConfig, loadEnv, normalizePath } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import { sourceIdentity } from './scripts/release-source.mjs'
import { mountPath,writeReleaseMarker } from './scripts/release-artifact.mjs'

const here = (file: string) => normalizePath(fileURLToPath(new URL(file, import.meta.url)))
/** All builds use the same wallet/API application. Modes select appearance and
 * output directories only; local-chain tests use an actual wallet provider. */
export default defineConfig(({ mode }) => {
  // Load public .env settings too, so Windows installs need no POSIX syntax.
  const live=mode==='live'
  const settings = loadEnv(mode, process.cwd(), 'VITE_')
  // Appearance controls do not select the payment adapter. An explicit live
  // release can retain the approved lab styling without simulating requests.
  const tweaks=mode==='lab'||settings.VITE_UI_TWEAKS==='true'
  const basePath=mountPath(settings.VITE_BASE_PATH||'/')
  return {
  base: basePath,
  plugins: [react(), svgr(), {
    // A served release must identify its adapter independently of its appearance.
    // Operations can reject a preview bundle before enabling a payment route.
    name:'deployment-mode',writeBundle(options){
      writeReleaseMarker(resolve(options.dir!),{
        incentives:'canonical-api',wallet:true,appearanceControls:tweaks,
        basePath,release:sourceIdentity(here('.')),
      })
    },
  }, {
    name: 'omit-disabled-dev-tools', enforce: 'pre',
    resolveId(source) {
      if (!tweaks && source === '../dev/RowTweaks') return '\0no-tweaks'
    },
    load(id) { if (id === '\0no-tweaks') return 'export default function NoTweaks(){return null}' },
  }],
  define: { 'import.meta.env.VITE_DEV_TWEAKS': JSON.stringify(tweaks ? 'true' : 'false') },
  resolve: {
    alias: {
      '@fixed': here('./vendor/fixed-income-ui'),
      '@lab': here('./src/adapters'),
      '@merge/session':here('./src/merge/live-session.tsx'),
      '@packages/onchain-config/live-pool-apr/pools.json': here('./vendor/live-apr-shared/pools.json'),
      '@packages/api-types/live-pool-apr.mjs': here('./vendor/live-apr-shared/live-pool-apr.mjs'),
    },
    dedupe: ['react', 'react-dom', 'styled-components'],
  },
  build: { outDir: process.env.MERGE_BUILD_DIR || (live?'dist-live':'dist'), manifest: true },
  }
})
