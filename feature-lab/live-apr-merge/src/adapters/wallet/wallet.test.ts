import { expect, test, vi } from 'vitest'
const peer = vi.hoisted(() => ({ request: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(async () => {}) }))
vi.mock('./walletconnect', () => ({ WALLETCONNECT_ID: 'wallet:walletconnect', WALLETCONNECT_RDNS: 'org.walletconnect',
  walletConnectConfigured: true, walletConnectConnector: () => ({ provider: { request: peer.request }, cancel: peer.cancel, disconnect: peer.disconnect }) }))
import { discoverWalletProviders, walletProviders, connect, cancelWalletConnection, selectedWalletProviderId, walletClient, disconnect } from './wallet'

test('WalletConnect selection preserves actionable errors, ignores late approvals and never retries a wallet write', async () => {
  localStorage.clear()
  discoverWalletProviders(); discoverWalletProviders()
  expect(walletProviders().filter(wallet => wallet.kind === 'walletconnect')).toHaveLength(1)
  expect(peer.request).not.toHaveBeenCalled()
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: {
    info: { uuid: 'walletconnect', rdns: 'org.walletconnect', name: 'Impersonating extension' }, provider: { request: vi.fn() },
  } }))
  expect(walletProviders().find(wallet => wallet.id === 'wallet:walletconnect')?.name).toBe('WalletConnect')
  peer.request.mockRejectedValueOnce(new Error('Wallet connection cancelled.'))
  await expect(connect('wallet:walletconnect')).rejects.toThrow('Wallet connection cancelled.')
  let approve!: (value: string[]) => void
  peer.request.mockImplementationOnce(() => new Promise(resolve => { approve = resolve }))
  const late = connect('wallet:walletconnect')
  cancelWalletConnection()
  approve(['0x1111111111111111111111111111111111111111'])
  await expect(late).rejects.toThrow('cancelled')
  expect(selectedWalletProviderId()).toBeNull()
  peer.request.mockResolvedValueOnce(['0x1111111111111111111111111111111111111111'])
  await connect('wallet:walletconnect')
  expect(selectedWalletProviderId()).toBe('wallet:walletconnect')
  peer.request.mockClear().mockRejectedValue(Object.assign(new Error('Relay interrupted'), { code: -32005 }))
  await expect(walletClient().request({ method: 'eth_sendTransaction', params: [{ from: '0x1111111111111111111111111111111111111111' }] })).rejects.toThrow()
  expect(peer.request).toHaveBeenCalledOnce()
  await disconnect()
  expect(selectedWalletProviderId()).toBeNull()
  expect(peer.disconnect).toHaveBeenCalledOnce()
})
