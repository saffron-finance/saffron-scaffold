import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { fileURLToPath } from 'node:url'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const fixed = here('./vendor/fixed-income-ui')
const base = process.env.VITE_BASE_PATH || '/'

// Development uses the same two public, chain-scoped token endpoints as nginx.
// No auth/cookies or arbitrary token path may be forwarded to the public API.
const prices = Object.fromEntries(Object.entries({
  ETH: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
  USDG: '0x5fc5360d0400a0fd4f2af552add042d716f1d168',
}).map(([symbol, address]) => [`^${base}prices/${symbol}$`, {
  target: 'https://api.saffron.finance', changeOrigin: true,
  rewrite: () => `/api/v1/tokens/4663/${address}/price?symbol=${symbol}`,
  configure: (proxy: import('vite').HttpProxy.Server) => proxy.on('proxyReq', request => {
    request.removeHeader('authorization'); request.removeHeader('cookie')
  }),
}]))

/** Standalone HTML entry, using real upstream UI sources without its app shell.
 * The host aliases are the only cross-repository seam; the incentive feature
 * itself contains no deployment paths or duplicated wallet/database service.
 */
export default defineConfig(({ mode }) => {
  const devTweaks = loadEnv(mode, here('./'), 'VITE_').VITE_DEV_TWEAKS === 'true'
  return {
  plugins: [react(), svgr(), {
    // Skip resolving the whole dev module when disabled. Tree-shaking its JS
    // alone still lets Vite emit imported font assets into the normal bundle.
    name: 'isolate-dev-tweaks',
    enforce: 'pre',
    resolveId(source) {
      if (!devTweaks && source === '../dev/RowTweaks') return '\0no-dev-tweaks'
    },
    load(id) {
      if (id === '\0no-dev-tweaks') return 'export default function NoDevTweaks(){return null}'
    },
  }],
  base,
  envDir: here('./'),
  resolve: {
    alias: {
      '@fixed': fixed,
      '@lab': here('./src/adapters'),
      '@receipt': here('./shared/vault-request.mjs'),
      // Resolve imported host source against this prototype's pinned runtime.
      react: here('./node_modules/react'),
      'react-dom': here('./node_modules/react-dom'),
      'styled-components': here('./node_modules/styled-components'),
      'react-modal': here('./node_modules/react-modal'),
      viem: here('./node_modules/viem'),
    },
    dedupe: ['react', 'react-dom', 'styled-components'],
  },
  server: { port: 5187, proxy: { ...prices, [`${base}rpc`]: 'http://127.0.0.1:3201', [`${base}vault-requests`]: 'http://127.0.0.1:3201', [`${base}incentive-programs`]: 'http://127.0.0.1:3201' } },
  build: { outDir: 'dist' },
  }
})
