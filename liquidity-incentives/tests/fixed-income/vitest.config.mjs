import { resolve } from 'node:path'

const fi = process.env.SAFFRON_FIXED_INCOME_PATH
if (!fi) throw new Error('Run this suite through tests/fixed-income/run.mjs.')
export default {
  test: { globals: true, environment: 'node', include: ['tests/fixed-income/*.test.ts'],
    testTimeout: 30000, hookTimeout: 30000, fileParallelism: false, maxWorkers: 1 },
  resolve: { alias: {
    ...Object.fromEntries(['api-types', 'utils', 'bn', 'contract-types', 'onchain-config', 'core'].map(name =>
      [`@packages/${name}`, resolve(fi, 'packages', name, 'src')])),
    '@fi/db': resolve(fi, 'packages/core/src/db/pendingVaults.ts'),
    '@fi/dbPool': resolve(fi, 'packages/core/src/db/dbPool.ts'),
    '@fi/lib': resolve(fi, 'packages/core/src/lib/index.ts'),
    '@fi/provider': resolve(fi, 'apps/api/src/providers/PendingVaultProvider.ts'),
    '@fi/providers': resolve(fi, 'apps/api/src/providers/index.ts'),
    '@fi/tokenProvider': resolve(fi, 'apps/api/src/providers/TokenProvider.ts'),
    '@fi/bots': resolve(fi, 'apps/api/src/services/bots/index.ts'),
    '@fi/route': resolve(fi, 'apps/api/src/routes/pendingVaults.ts'),
    '@fi/walletAuth': resolve(fi, 'apps/api/src/middleware/walletAuth.ts'),
    '@fi/walletAdminAuth': resolve(fi, 'apps/api/src/middleware/walletAdminAuth.ts'),
    express: resolve(fi, 'node_modules/express/index.js'),
  } },
}
