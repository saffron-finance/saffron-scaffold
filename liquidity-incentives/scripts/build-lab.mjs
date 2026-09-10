import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Invoke Node entry points directly to avoid shell-specific environment syntax.
for (const [entry, args] of [['typescript/bin/tsc', ['--noEmit']], ['vite/bin/vite.js', ['build']]]) {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../node_modules/' + entry, import.meta.url)), ...args], {
    stdio: 'inherit', windowsHide: true, env: { ...process.env, VITE_DEV_TWEAKS: 'true' },
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
