import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// Python owns ZIP parsing; run its real verifier with independently built
// fixtures. No shell, installed packages, network or release credentials.
test('source archive adversarial and trusted-release contracts', () => {
  const result = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-O', fileURLToPath(new URL('./source_archive_contracts.py', import.meta.url))], { encoding: 'utf8' })
  assert.equal(result.status, 0, result.stdout + result.stderr)
  process.stdout.write(result.stdout)
})
