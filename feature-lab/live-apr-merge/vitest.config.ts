import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
const here = (file: string) => fileURLToPath(new URL(file, import.meta.url))
/** Run the imported behavioral contracts against this package's one runtime. */
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { alias: {
    '@lab': here('./src/adapters'),
    '@merge/session': here('./src/merge/live-session.tsx'),
    '@fixed': here('./vendor/fixed-income-ui'),
    '@packages/onchain-config/live-pool-apr/pools.json': here('./vendor/live-apr-shared/pools.json'),
    '@packages/api-types/live-pool-apr.mjs': here('./vendor/live-apr-shared/live-pool-apr.mjs'),
    'src/shared/styles/themes/darkTheme': here('./vendor/fixed-income-ui/shared/styles/themes/darkTheme.ts'),
  } },
  // A package-local setup module lets Vite resolve its ESM imports from this
  // package even when the parent checkout also has a different Vitest install.
  test: { environment: 'jsdom', setupFiles: [here('./tests/browser-storage.mjs')], include: ['src/**/*.test.{ts,tsx}'] },
})
