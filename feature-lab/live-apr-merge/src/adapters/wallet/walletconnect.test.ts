import { expect, test, vi } from 'vitest'
import { createWalletConnectConnector, type WalletConnectSdk, type WalletConnectSession } from './walletconnect'

const address = '0x1111111111111111111111111111111111111111'
const other = '0x2222222222222222222222222222222222222222'
const config = { projectId: 'a'.repeat(32), baseUrl: 'https://example.test/incentives/' }
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void
  const promise = new Promise<T>((a, b) => { resolve = a; reject = b }); return { promise, resolve, reject } }
function fixture() {
  let session: WalletConnectSession | undefined
  let accounts = [address]
  const listeners = new Map<string, Set<() => void>>()
  const proposal = deferred<void>()
  const valid = (chain = 4663, methods = ['eth_sendTransaction']) => ({ topic: 'approved-topic', expiry: Date.now() / 1000 + 600,
    namespaces: { eip155: { methods, accounts: [`eip155:${chain}:${address}`, `eip155:${chain}:${other}`] } } })
  const sdk: WalletConnectSdk = {
    provider: { request: vi.fn(async ({ method }) => method === 'eth_accounts' ? accounts : method === 'eth_chainId' ? '0x1237' : '0xhash'),
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(fn) },
      removeListener(event, fn) { listeners.get(event)?.delete(fn) } },
    session: () => session, connect: vi.fn(() => proposal.promise), closeModal: vi.fn(),
    disconnect: vi.fn(async () => { session = undefined; emit('disconnect') }),
  }
  const emit = (event: string) => listeners.get(event)?.forEach(fn => fn())
  const data = new Map<string, string>()
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value) }, removeItem: (key: string) => { data.delete(key) } }
  const load = vi.fn(async () => sdk)
  const create = () => createWalletConnectConnector(config, load, storage)
  return { sdk, load, data, create, proposal, valid, emit, setSession(value: WalletConnectSession | undefined) { session = value }, setAccounts(value: string[]) { accounts = value } }
}

test('discovery and account reads with no accepted session never load the relay or open pairing', async () => {
  const f = fixture(), c = f.create()
  expect(await c.provider.request({ method: 'eth_accounts' })).toEqual([])
  await c.disconnect()
  expect(f.load).not.toHaveBeenCalled()
})

test('explicit connection is deduplicated, approves only Robinhood accounts, and restores without pairing or sending', async () => {
  const f = fixture(), c = f.create()
  const first = c.provider.request({ method: 'eth_requestAccounts' })
  const duplicate = c.provider.request({ method: 'eth_requestAccounts' })
  await vi.waitFor(() => expect(f.sdk.connect).toHaveBeenCalledTimes(1))
  f.setSession(f.valid()); f.proposal.resolve()
  expect(await first).toEqual([address]); expect(await duplicate).toEqual([address])
  const restored = f.create()
  expect(await restored.provider.request({ method: 'eth_accounts' })).toEqual([address])
  expect(f.sdk.connect).toHaveBeenCalledTimes(1)
  expect(vi.mocked(f.sdk.provider.request).mock.calls.every(([call]) => call.method === 'eth_accounts')).toBe(true)
  await restored.provider.request({ method: 'eth_sendTransaction', params: [{ from: address }] })
  expect(f.sdk.provider.request).toHaveBeenLastCalledWith({ method: 'eth_sendTransaction', params: [{ from: address }] })
})

test.each(['wrong chain', 'missing permission', 'expired'])('rejects a session with %s', async reason => {
  const f = fixture(), c = f.create()
  const outcome = c.provider.request({ method: 'eth_requestAccounts' })
  const failure = expect(outcome).rejects.toThrow('did not approve Robinhood')
  await vi.waitFor(() => expect(f.sdk.connect).toHaveBeenCalledOnce())
  const session = f.valid(reason === 'wrong chain' ? 1 : 4663, reason === 'missing permission' ? ['personal_sign'] : undefined)
  if (reason === 'expired') session.expiry = 1
  f.setSession(session); f.proposal.resolve(); await failure
  expect(await c.provider.request({ method: 'eth_accounts' })).toEqual([])
  expect(f.sdk.disconnect).toHaveBeenCalledOnce()
  expect(f.data.size).toBe(0)
})

test('cancelled proposals cannot reconnect after late approval or start an overlapping proposal', async () => {
  const f = fixture(), c = f.create()
  const outcome = c.provider.request({ method: 'eth_requestAccounts' })
  const cancelled = expect(outcome).rejects.toThrow('cancelled')
  await vi.waitFor(() => expect(f.sdk.connect).toHaveBeenCalledOnce())
  c.cancel(); await cancelled
  expect(vi.mocked(f.sdk.connect).mock.calls[0][1].aborted).toBe(true)
  await expect(c.provider.request({ method: 'eth_requestAccounts' })).rejects.toThrow('still pending')
  f.setSession(f.valid()); f.proposal.resolve()
  await vi.waitFor(() => expect(f.sdk.disconnect).toHaveBeenCalledOnce())
  expect(await c.provider.request({ method: 'eth_accounts' })).toEqual([])
  expect(f.data.size).toBe(0)
})

test('cancelling while loading cannot open a delayed pairing modal', async () => {
  const f = fixture(), loading = deferred<WalletConnectSdk>()
  const c = createWalletConnectConnector(config, () => loading.promise)
  const outcome = c.provider.request({ method: 'eth_requestAccounts' })
  const cancelled = expect(outcome).rejects.toThrow('cancelled')
  c.cancel(); await cancelled
  loading.resolve(f.sdk)
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(f.sdk.connect).not.toHaveBeenCalled()
})

test('a wallet rejection clears the attempt so an explicit retry can succeed', async () => {
  const f = fixture(), c = f.create()
  vi.mocked(f.sdk.connect).mockRejectedValueOnce(new Error('User rejected'))
  await expect(c.provider.request({ method: 'eth_requestAccounts' })).rejects.toThrow('User rejected')
  const retry = c.provider.request({ method: 'eth_requestAccounts' })
  await vi.waitFor(() => expect(f.sdk.connect).toHaveBeenCalledTimes(2))
  f.setSession(f.valid()); f.proposal.resolve()
  expect(await retry).toEqual([address])
})

test('account updates, expiry and peer disconnect invalidate the view without sending', async () => {
  const f = fixture(), c = f.create()
  const connect = c.provider.request({ method: 'eth_requestAccounts' })
  await vi.waitFor(() => expect(f.sdk.connect).toHaveBeenCalledOnce())
  f.setSession(f.valid()); f.proposal.resolve(); await connect
  const changed = vi.fn(); c.provider.on?.('accountsChanged', changed)
  f.setAccounts([other]); f.emit('accountsChanged')
  expect(changed).toHaveBeenCalledOnce()
  expect(await c.provider.request({ method: 'eth_accounts' })).toEqual([other])
  f.setSession({ ...f.valid(), expiry: 1 })
  expect(await c.provider.request({ method: 'eth_accounts' })).toEqual([])
  await expect(c.provider.request({ method: 'eth_sendTransaction' })).rejects.toThrow('expired or changed')
  f.setSession(undefined); f.emit('disconnect')
  expect(f.data.size).toBe(0)
  expect(await c.provider.request({ method: 'eth_accounts' })).toEqual([])
})

test('disconnect removes accepted session and prevents cached account reads from returning', async () => {
  const f = fixture(), c = f.create()
  const connect = c.provider.request({ method: 'eth_requestAccounts' })
  await vi.waitFor(() => expect(f.sdk.connect).toHaveBeenCalledOnce())
  f.setSession(f.valid()); f.proposal.resolve(); await connect
  const read = deferred<string[]>()
  vi.mocked(f.sdk.provider.request).mockReturnValueOnce(read.promise)
  const accounts = c.provider.request({ method: 'eth_accounts' })
  await vi.waitFor(() => expect(f.sdk.provider.request).toHaveBeenCalledTimes(2))
  await c.disconnect(); read.resolve([address])
  expect(await accounts).toEqual([])
  expect(f.data.size).toBe(0)
  await expect(c.provider.request({ method: 'eth_sendTransaction' })).rejects.toThrow('disconnected')
})
