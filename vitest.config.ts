import {defineConfig} from 'vitest/config'
// Root legacy regressions intentionally exclude independently packaged apps.
export default defineConfig({test:{environment:'jsdom',include:['src/**/*.test.{ts,tsx}']}})
