import { spawn } from 'node:child_process'
import { resolve, join } from 'node:path'
import { access } from 'node:fs/promises'

const checkout = resolve(process.argv[2] || process.env.SAFFRON_FIXED_INCOME_PATH || '../../fixed-income')
const runner = join(checkout, 'node_modules/vitest/vitest.mjs')
try { await access(runner); await access(join(checkout, 'apps/api/src/routes/pendingVaults.ts')) }
catch { throw new Error('Provide an installed fixed-income checkout: npm run test:fixed-income -- /path/to/fixed-income') }
const child = spawn(process.execPath, [runner, 'run', '--config', 'tests/fixed-income/vitest.config.mjs'], {
  stdio: 'inherit', env: { ...process.env, SAFFRON_FIXED_INCOME_PATH: checkout },
})
child.on('exit', code => { process.exitCode = code ?? 1 })
child.on('error', () => { process.exitCode = 1 })
