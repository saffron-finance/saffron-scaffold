import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import config from '../vite.config'

/** Isolated browser-test build. Omit the release marker so a wallet fixture
 * cannot pass deployment preflight or masquerade as a releasable live build. */
export default defineConfig(async env => {
  const source = await (config as Function)(env)
  return { ...source, plugins: source.plugins.filter((plugin: { name: string }) => plugin.name !== 'deployment-mode'),
    resolve: { ...source.resolve, alias: { ...source.resolve.alias,
      '@walletconnect/ethereum-provider': fileURLToPath(new URL('./walletconnect-provider.mjs', import.meta.url)) } },
    build: { ...source.build, outDir: 'validation/walletconnect-build' } }
})
