import { expect, it, vi } from 'vitest'
import { createWalletConnectSdk } from './walletconnect-sdk'

const provider = vi.hoisted(() => ({ connect: vi.fn(), request: vi.fn(), on: vi.fn(), removeListener: vi.fn() }))
vi.mock('@walletconnect/ethereum-provider', () => ({ EthereumProvider: { init: async () => provider } }))
vi.mock('@reown/appkit/core', async () => { throw new Error('AppKit download failed') })

/** Exercise the second, nested import in the real SDK adapter, not just a
 * rejected outer connector loader. No pairing or wallet write may start. */
it('propagates QR UI download failure before opening a proposal or sending', async () => {
  const sdk = await createWalletConnectSdk({ projectId: 'a'.repeat(32), baseUrl: 'https://example.test/' })
  await expect(sdk.connect(vi.fn(), new AbortController().signal)).rejects.toThrow()
  expect(provider.connect).not.toHaveBeenCalled()
  expect(provider.request).not.toHaveBeenCalled()
  sdk.closeModal()
})
