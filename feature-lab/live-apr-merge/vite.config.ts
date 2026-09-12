import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { fileURLToPath } from 'node:url'
import { dirname,resolve } from 'node:path'

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url))
/** Compile-time separation: default/lab builds keep no-funds sample adapters.
 * The explicit live build uses the current wallet/API recovery implementation. */
export default defineConfig(({ mode }) => {
  // Load public .env settings too, so Windows installs need no POSIX syntax.
  const live=mode==='live'
  const replaced=new Set(['transport','useOfferPrice','useDeploymentFlow','useVaultPosition'].map(name=>here('./src/host/'+name)))
  const settings = loadEnv(mode, process.cwd(), 'VITE_')
  // Appearance controls do not select the payment adapter. An explicit live
  // release can retain the approved lab styling without simulating requests.
  const tweaks=mode==='lab'||(live&&settings.VITE_UI_TWEAKS==='true')
  return {
  base: settings.VITE_BASE_PATH || '/',
  plugins: [react(), svgr(), {
    // A served release must identify its adapter independently of its appearance.
    // Operations can reject a preview bundle before enabling a payment route.
    name:'deployment-mode',generateBundle(){
      this.emitFile({type:'asset',fileName:'deployment-mode.json',source:JSON.stringify({
        incentives:live?'canonical-api':'browser-simulation',wallet:live,appearanceControls:tweaks,
        basePath:settings.VITE_BASE_PATH||'/',
      },null,2)+'\n'})
    },
  }, {name:'separate-incentive-mode',enforce:'pre',resolveId(source,importer){
    if(!live&&importer&&source.startsWith('.')&&replaced.has(resolve(dirname(importer),source).replace(/\.tsx?$/,'')))return here('./src/preview/runtime.ts')
  }}, {
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
      '@merge/session':here(live?'./src/merge/live-session.tsx':'./src/preview/runtime.ts'),
      '@packages/onchain-config/live-pool-apr/pools.json': here('./vendor/live-apr-shared/pools.json'),
      '@packages/api-types/live-pool-apr.mjs': here('./vendor/live-apr-shared/live-pool-apr.mjs'),
    },
    dedupe: ['react', 'react-dom', 'styled-components'],
  },
  build: { outDir: process.env.MERGE_BUILD_DIR || (live?'dist-live':'dist'), manifest: true },
  }
})
