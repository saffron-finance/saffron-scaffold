import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import svgr from 'vite-plugin-svgr'
import { fileURLToPath } from 'node:url'

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url))
const fixed = here('./vendor/fixed-income-ui')
const base = process.env.VITE_BASE_PATH || '/'

/** Independent application with explicitly vendored UI primitives. */
export default defineConfig(({ mode }) => {
  const devTweaks = loadEnv(mode, here('./'), 'VITE_').VITE_DEV_TWEAKS === 'true'
  const api = process.env.DEV_API_ORIGIN || 'http://127.0.0.1:3201'
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
      // Resolve imported host source against this prototype's pinned runtime.
      react: here('./node_modules/react'),
      'react-dom': here('./node_modules/react-dom'),
      'styled-components': here('./node_modules/styled-components'),
      'react-modal': here('./node_modules/react-modal'),
      viem: here('./node_modules/viem'),
    },
    dedupe: ['react', 'react-dom', 'styled-components'],
  },
  // Node owns address validation and upstream pricing in development and production.
  server: { port: 5187, proxy: Object.fromEntries(['prices', 'rpc', 'api/incentives'].map(path => [`${base}${path}`, api])) },
  build: { outDir: 'dist' },
  }
})
