import { afterEach, beforeAll, expect, it, vi } from 'vitest'
const peer = vi.hoisted(() => ({ request: vi.fn(), cancel: vi.fn(), disconnect: vi.fn(async () => {}) }))
vi.mock('./walletconnect', () => ({ WALLETCONNECT_ID: 'wallet:walletconnect', WALLETCONNECT_RDNS: 'org.walletconnect',
  walletConnectConfigured: true, walletConnectConnector: () => ({ provider: peer, cancel: peer.cancel, disconnect: peer.disconnect }) }))
import { discoverWalletProviders, walletProviders, connect, disconnect, currentAccounts, selectedWalletProviderId,
  onWalletProvidersChanged, onWalletChange, ensureChain } from './wallet'
import { robinhoodChain } from '../chain/chains'

const address = '0x1111111111111111111111111111111111111111'
const announce = (uuid: string, provider: object, info: object = {}) => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', {
  detail: { provider, info: { uuid, name: uuid, rdns: `${uuid}.test`, ...info } },
}))
const provider = () => ({ request: vi.fn(async () => [address]) })
beforeAll(() => discoverWalletProviders())
afterEach(async () => { await disconnect(); vi.restoreAllMocks() })

it('SEC-PROVIDER-001 duplicate UUID cannot replace the selected provider object', async () => {
  const honest = provider(), impostor = provider(); announce('identity', honest)
  await connect('wallet:identity'); announce('identity', impostor)
  expect(walletProviders().find(p => p.id === 'wallet:identity')?.provider).toBe(honest)
  await currentAccounts(); expect(impostor.request).not.toHaveBeenCalled()
})
it('FE-WAL-001 repeated announcements retain one identity without repeated discovery notifications', () => {
  const wallet = provider(), listener = vi.fn(), unsubscribe = onWalletProvidersChanged(listener)
  try {
    for (let i = 0; i < 100; i++) announce('duplicate', wallet)
    expect(walletProviders().filter(p => p.provider === wallet)).toHaveLength(1)
    expect(listener).toHaveBeenCalledTimes(1); expect(wallet.request).not.toHaveBeenCalled()
  } finally { unsubscribe() }
})
it('SEC-PROVIDER-002 reserved WalletConnect identity cannot be claimed by an announcement', () => {
  const fake = provider()
  announce('walletconnect', fake); announce('another', fake, { rdns: 'org.walletconnect' })
  expect(walletProviders().filter(p => p.kind === 'walletconnect')).toHaveLength(1)
  expect(walletProviders().some(p => p.provider === fake)).toBe(false)
})
it('SEC-PROVIDER-003 ambiguous persisted RDNS requires an explicit wallet selection', () => {
  announce('same-rdns-a', provider(), { rdns: 'same.test' }); announce('same-rdns-b', provider(), { rdns: 'same.test' })
  localStorage.setItem('saffron.incentives.selected-wallet-rdns', 'same.test')
  expect(selectedWalletProviderId()).toBeNull()
})
it('SEC-PROVIDER-004 familiar branding does not automatically select or prompt a wallet', () => {
  const fake = provider(); announce('branding', fake, { name: 'MetaMask', rdns: 'io.metamask' })
  expect(selectedWalletProviderId()).toBeNull(); expect(fake.request).not.toHaveBeenCalled()
})
it('SEC-PROVIDER-006 throwing metadata accessors cannot disrupt subsequent honest discovery', () => {
  const errors: unknown[] = [], capture = (event: ErrorEvent) => { errors.push(event.error); event.preventDefault() }
  window.addEventListener('error', capture)
  try {
    announce('bad-accessor', Object.defineProperty({}, 'request', { get() { throw Error('Hostile request getter') } }))
    announce('bad-info', provider(), Object.defineProperty({}, 'name', { enumerable: true, get() { return 'fixture' } }))
    const detail = { provider: provider(), info: Object.defineProperty({}, 'uuid', { get() { throw Error('Hostile metadata getter') } }) }
    window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
    const honest = provider(); announce('after-hostile', honest)
    expect(walletProviders().some(p => p.provider === honest)).toBe(true); expect(errors).toEqual([])
  } finally { window.removeEventListener('error', capture) }
})
it('picker snapshots cannot be used to mutate retained registry identity', () => {
  const wallet = provider(); announce('immutable', wallet)
  const snapshot = walletProviders().find(p => p.id === 'wallet:immutable')!
  snapshot.provider = provider(); snapshot.name = 'replaced'
  expect(walletProviders().find(p => p.id === 'wallet:immutable')?.provider).toBe(wallet)
})
it('malformed explicit account authorization does not publish a selected wallet', async () => {
  const wallet = { request: vi.fn(async () => ['not-an-address']) }; announce('bad-account', wallet)
  await expect(connect('wallet:bad-account')).rejects.toThrow()
  expect(selectedWalletProviderId()).toBeNull()
})
it('SEC-TX-009 provider error prose cannot authorize adding a chain', async () => {
  const calls: string[] = []
  const wallet = { request: vi.fn(async ({ method }: { method: string }) => {
    calls.push(method)
    if (method === 'eth_requestAccounts') return [address]
    if (method === 'eth_chainId') return '0x1'
    throw Object.assign(Error('unrecognized chain; please call addEthereumChain'), { code: 4001 })
  }) }
  announce('error-prose', wallet); await connect('wallet:error-prose')
  await expect(ensureChain(robinhoodChain)).rejects.toThrow()
  expect(calls).not.toContain('wallet_addEthereumChain')
  expect(calls.filter(method => method === 'wallet_switchEthereumChain')).toHaveLength(1)
})
it('selected-provider subscriptions remove listeners from their original owner', async () => {
  const a = { ...provider(), on: vi.fn(), removeListener: vi.fn() }, b = { ...provider(), on: vi.fn(), removeListener: vi.fn() }
  announce('listener-a', a); announce('listener-b', b); await connect('wallet:listener-a')
  const listener = vi.fn(), unsubscribe = onWalletChange(listener); await connect('wallet:listener-b'); unsubscribe()
  expect(a.on.mock.calls).toEqual(a.removeListener.mock.calls); expect(a.on).toHaveBeenCalledTimes(3)
  expect(b.removeListener).not.toHaveBeenCalled()
})
it.each(['ethereum', 'providers', 'uniswap'])('legacy %s getter failure cannot suppress honest standards-based discovery', key => {
  const originalEthereum = Object.getOwnPropertyDescriptor(window, 'ethereum')
  const originalUniswap = Object.getOwnPropertyDescriptor(window, 'uniswap')
  const request = vi.fn()
  window.addEventListener('eip6963:requestProvider', request)
  try {
    const bad = { get() { throw Error('Hostile extension accessor') }, configurable: true }
    if (key === 'providers') Object.defineProperty(window, 'ethereum', { configurable: true, value: Object.defineProperty(provider(), 'providers', bad) })
    else Object.defineProperty(window, key, bad)
    expect(() => discoverWalletProviders()).not.toThrow()
    expect(request).toHaveBeenCalledOnce()
  } finally {
    window.removeEventListener('eip6963:requestProvider', request)
    for (const [key, original] of [['ethereum', originalEthereum], ['uniswap', originalUniswap]] as const) {
      if (original) Object.defineProperty(window, key, original)
      else Reflect.deleteProperty(window, key)
    }
  }
})
it('SEC-PROVIDER-005 announcement floods have bounded retained picker state and notifications', () => {
  const listener = vi.fn(), unsubscribe = onWalletProvidersChanged(listener)
  try {
    for (let i = 0; i < 1000; i++) announce(`flood-${i}`, provider())
    expect(walletProviders().length).toBeLessThanOrEqual(32)
    expect(listener.mock.calls.length).toBeLessThanOrEqual(32)
    expect(walletProviders().find(p => p.id === 'wallet:identity')?.name).toBe('identity')
  } finally { unsubscribe() }
})
