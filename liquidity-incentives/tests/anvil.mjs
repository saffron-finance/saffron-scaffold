import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export function anvilBinary() {
  const arch = { x64: 'amd64', arm64: 'arm64' }[process.arch]
  if (!arch || !['win32', 'linux', 'darwin'].includes(process.platform)) throw new Error('Unsupported Anvil test platform.')
  const binary = process.platform === 'win32' ? 'anvil.exe' : 'anvil'
  try { return require.resolve(`@foundry-rs/anvil-${process.platform}-${arch}/bin/${binary}`) }
  catch { throw new Error('Install this platform\'s optional Anvil package with npm ci (do not omit optional dependencies).') }
}
