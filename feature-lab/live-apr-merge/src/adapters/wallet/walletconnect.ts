import { isAddress, type Address } from 'viem'
import type { Eip1193Provider } from './wallet'

export const WALLETCONNECT_ID = 'wallet:walletconnect'
export const WALLETCONNECT_RDNS = 'org.walletconnect'
export const walletConnectConfigured = /^[0-9a-f]{32}$/i.test(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID ?? '')

export type WalletConnectSession = {
  topic: string
  expiry: number
  namespaces: Record<string, { accounts: string[]; methods: string[] }>
}
export type WalletConnectSdk = {
  provider: Eip1193Provider
  session: () => WalletConnectSession | undefined
  connect: (onCancel: () => void, signal: AbortSignal) => Promise<void>
  closeModal: () => void
  disconnect: () => Promise<void>
}
export type WalletConnectConfig = { projectId: string; baseUrl: string }

/** Only the session explicitly approved in this application can be restored.
 * A closed proposal can still settle in the SDK, so its topic is never admitted
 * as a selected wallet. Pairing URIs and keys stay inside the SDK's own storage. */
export function createWalletConnectConnector(config: WalletConnectConfig,
  load: () => Promise<WalletConnectSdk> = () => import('./walletconnect-sdk').then(module => module.createWalletConnectSdk(config)),
  storage: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | undefined = undefined) {
  const key = 'saffron.incentives.walletconnect-session:' + new URL(config.baseUrl).pathname
  const listeners = new Map<string, Set<() => void>>()
  let sdkPromise: Promise<WalletConnectSdk> | undefined, sdk: WalletConnectSdk | undefined
  let acceptedTopic: string | null = null, generation = 0, pending: Promise<Address[]> | undefined
  let connection: Promise<Address[]> | undefined, cancelAttempt: (() => void) | undefined
  let resetting: Promise<void> | undefined, disabled = false
  try { acceptedTopic = storage?.getItem(key) ?? null } catch { /* Private browsing can still connect in memory. */ }
  const emit = (event: string) => { for (const fn of listeners.get(event) ?? []) fn() }
  const remember = (topic: string | null) => {
    acceptedTopic = topic
    try { if (topic) storage?.setItem(key, topic); else storage?.removeItem(key) } catch { /* Session remains in memory. */ }
  }
  const approved = (session: WalletConnectSession | undefined): Address[] => {
    if (!session || session.expiry * 1000 <= Date.now()) return []
    return [...new Set(Object.entries(session.namespaces).flatMap(([name, scope]) => {
      if (!['eip155', 'eip155:4663'].includes(name) || !scope.methods.includes('eth_sendTransaction')) return []
      return scope.accounts.filter(value => /^eip155:4663:0x[0-9a-f]{40}$/i.test(value))
        .map(value => value.split(':')[2] as Address)
    }))]
  }
  const admitted = () => !disabled && sdk?.session()?.topic === acceptedTopic && approved(sdk?.session()).length > 0
  async function initialize() {
    sdkPromise ??= load().then(value => {
      sdk = value
      for (const event of ['accountsChanged', 'chainChanged', 'session_update']) value.provider.on?.(event, () => emit(event === 'session_update' ? 'accountsChanged' : event))
      value.provider.on?.('disconnect', () => { remember(null); emit('disconnect') })
      return value
    }).catch(error => { sdkPromise = undefined; throw error })
    return sdkPromise
  }
  async function accounts(): Promise<Address[]> {
    // Discovery/refresh may restore an approved session, never initiate pairing.
    if (disabled || !acceptedTopic) return []
    const version = generation
    const value = await initialize()
    if (!admitted()) return []
    const addresses = await value.provider.request({ method: 'eth_accounts' })
    if (version !== generation || !admitted()) return []
    const allowed = new Set(approved(value.session()).map(address => address.toLowerCase()))
    return Array.isArray(addresses) ? addresses.filter((address): address is Address => typeof address === 'string'
      && isAddress(address) && allowed.has(address.toLowerCase())) : []
  }
  function start(): Promise<Address[]> {
    if (pending) return Promise.reject(new Error('A connection request is still pending in your wallet. Reject it there before trying again.'))
    disabled = false
    const version = ++generation
    const abort = new AbortController()
    const cancelled = () => new Error('Wallet connection cancelled.')
    let rejectCancel!: (error: Error) => void
    const cancellation = new Promise<never>((_, reject) => { rejectCancel = reject })
    cancelAttempt = () => {
      if (abort.signal.aborted) return
      generation++
      abort.abort()
      rejectCancel(cancelled())
      sdk?.closeModal()
    }
    const operation = (async () => {
      if (resetting) await resetting
      const value = await initialize()
      if (version !== generation) throw cancelled()
      if (!admitted()) {
        remember(null)
        if (value.session()) await value.disconnect()
        if (version !== generation) throw cancelled()
        // Keep this operation occupied through late approval and cleanup. The
        // SDK cannot abort an already published proposal; a second one could
        // otherwise overwrite its session while the first is still settling.
        await value.connect(() => cancelAttempt?.(), abort.signal)
      }
      if (version !== generation) { await value.disconnect(); throw cancelled() }
      const session = value.session()
      if (!approved(session).length) {
        await value.disconnect()
        throw new Error('This wallet did not approve Robinhood Chain (4663) transactions. Use a wallet that supports this network.')
      }
      remember(session!.topic)
      const addresses = await accounts()
      if (version !== generation) { remember(null); await value.disconnect(); throw cancelled() }
      if (!addresses[0]) { remember(null); await value.disconnect(); throw new Error('No Robinhood account was authorized.') }
      emit('accountsChanged')
      return addresses
    })().finally(() => { if (pending === operation) pending = undefined })
    pending = operation
    return Promise.race([operation, cancellation]).finally(() => { cancelAttempt = undefined })
  }
  const connect = () => {
    if (connection) return connection
    connection = start().finally(() => { connection = undefined })
    return connection
  }
  const disconnect = () => {
    disabled = true; generation++; remember(null); cancelAttempt?.()
    emit('disconnect')
    // Do not initialize a disconnected session just to tear it down. A session
    // that settles after cancellation is reconciled by the occupied operation.
    if (sdkPromise && !pending) resetting = sdkPromise.then(value => value.disconnect()).finally(() => { resetting = undefined })
    return resetting ?? Promise.resolve()
  }
  const provider: Eip1193Provider = {
    async request(args) {
      if (args.method === 'eth_requestAccounts') return connect()
      if (args.method === 'eth_accounts') return accounts()
      if (disabled || !acceptedTopic) throw new Error('WalletConnect is disconnected. Reconnect your wallet.')
      const value = await initialize()
      if (!admitted()) throw new Error('WalletConnect session expired or changed. Reconnect your wallet.')
      return value.provider.request(args)
    },
    on(event, listener) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(listener) },
    removeListener(event, listener) { listeners.get(event)?.delete(listener) },
  }
  return { provider, cancel: () => cancelAttempt?.(), disconnect }
}

let connector: ReturnType<typeof createWalletConnectConnector> | undefined
export function walletConnectConnector() {
  if (!walletConnectConfigured) throw new Error('WalletConnect is not configured for this application.')
  let storage: Storage | undefined
  try { storage = window.localStorage } catch { /* In-memory connection is still available. */ }
  return connector ??= createWalletConnectConnector({ projectId: import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
    baseUrl: new URL(import.meta.env.BASE_URL, window.location.origin).href }, undefined, storage)
}
