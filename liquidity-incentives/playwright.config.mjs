import { defineConfig } from '@playwright/test'

// Run the production bundle with all wallet/RPC/API calls intercepted by the
// fixture. The fixture uses real signature verification and disposable Postgres.
export default defineConfig({
  testDir: './tests/browser', testMatch: '*.spec.mjs', timeout: 35_000, workers: 1,
  use: { baseURL: 'http://127.0.0.1:13218', headless: true, trace: 'retain-on-failure' },
  webServer: { command: 'npx vite preview --host 127.0.0.1 --port 13218',
    url: 'http://127.0.0.1:13218/', reuseExistingServer: false },
})
