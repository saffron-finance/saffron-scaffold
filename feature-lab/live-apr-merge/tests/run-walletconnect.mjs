import { spawnSync } from 'node:child_process'
const run = (script, args, env) => {
  const result = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit', env })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
run('node_modules/vite/bin/vite.js', ['build', '--mode', 'live', '--config', 'tests/walletconnect.vite.ts'],
  { ...process.env, VITE_BASE_PATH: '/', VITE_WALLETCONNECT_PROJECT_ID: 'a'.repeat(32) })
run('tests/backend-browser.mjs', [], { ...process.env, MERGE_WALLETCONNECT_FIXTURE: '1' })
