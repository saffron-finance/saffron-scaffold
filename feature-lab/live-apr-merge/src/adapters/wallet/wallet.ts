import { createPublicClient, createWalletClient, custom, type Address, type Chain } from 'viem'

// This module deliberately implements only the small browser-wallet boundary
// This application needs. EIP-6963 discovery allows multiple extensions—including the
// Uniswap Extension—to coexist without fighting over `window.ethereum`.

export type Eip1193Provider = {
  request: (args: { method: string; params?: unknown[] }) => Promise<unknown>
  on?: (event: string, handler: () => void) => void
  removeListener?: (event: string, handler: () => void) => void
}

type Eip6963ProviderInfo = {
  uuid: string
  name: string
  icon: string
  rdns: string
}

type Eip6963ProviderDetail = {
  info: Eip6963ProviderInfo
  provider: Eip1193Provider
}

export type WalletProvider = {
  id: string
  name: string
  icon?: string
  rdns?: string
  provider: Eip1193Provider
}

type InjectedWindow = Window & {
  ethereum?: Eip1193Provider & {
    providers?: Eip1193Provider[]
    isMetaMask?: boolean
    isCoinbaseWallet?: boolean
  }
  // Older Uniswap Extension releases also exposed this alias. EIP-6963 is the
  // primary path, but retaining the alias makes discovery backwards-compatible.
  uniswap?: Eip1193Provider
}

const SELECTED_PROVIDER_KEY = 'saffron.incentives.selected-wallet-provider'
const SELECTED_RDNS_KEY = 'saffron.incentives.selected-wallet-rdns'
const providers = new Map<string, WalletProvider>()
const providerIds = new WeakMap<object, string>()
const providerListeners = new Set<() => void>()
let discoveryStarted = false
let selectedProviderIdMemory: string | null = null

/** Read the stored wallet selection without failing in private browsing. */
function storedProviderId(): string | null {
  if (selectedProviderIdMemory) return selectedProviderIdMemory
  try {
    // EIP-6963 UUIDs and legacy injection order can change on reload. Persist
    // the selected wallet's RDNS, and restore only one unambiguous match.
    const rdns = localStorage.getItem(SELECTED_RDNS_KEY)
    const matches = [...providers.values()].filter((wallet) => rdns && wallet.rdns === rdns)
    return matches.length === 1 ? matches[0].id : null
  } catch {
    return selectedProviderIdMemory
  }
}

/** Notify hooks when an extension announces itself after the first render. */
function notifyProviderListeners(): void {
  for (const listener of providerListeners) listener()
}

/**
 * Add or enrich a provider while deduplicating legacy and EIP-6963 injection.
 * A provider announced after the fallback scan keeps its stable internal ID so
 * a previously selected wallet remains selected, but gains its official name
 * and icon from the EIP-6963 announcement.
 */
function registerProvider(provider: Eip1193Provider, info: Partial<Eip6963ProviderInfo>): void {
  if (!provider || typeof provider.request !== 'function') return

  const providerObject = provider as object
  const existingId = providerIds.get(providerObject)
  const id = existingId ?? `wallet:${info.uuid ?? providers.size + 1}`
  const previous = existingId ? providers.get(existingId) : undefined

  providerIds.set(providerObject, id)
  providers.set(id, {
    id,
    name: info.name ?? previous?.name ?? 'Browser wallet',
    icon: info.icon || previous?.icon,
    rdns: info.rdns || previous?.rdns,
    provider,
  })
  notifyProviderListeners()
}

/** Give legacy injected wallets a useful label when EIP-6963 is unavailable. */
function legacyProviderName(provider: Eip1193Provider, index: number): string {
  const flags = provider as Eip1193Provider & {
    isMetaMask?: boolean
    isCoinbaseWallet?: boolean
    isUniswapWallet?: boolean
  }
  if (flags.isUniswapWallet) return 'Uniswap Extension'
  if (flags.isCoinbaseWallet) return 'Coinbase Wallet'
  if (flags.isMetaMask) return 'MetaMask'
  return index === 0 ? 'Browser wallet' : `Browser wallet ${index + 1}`
}

/**
 * Start EIP-6963 discovery and register older injected-provider fallbacks.
 * Calling this repeatedly is safe; each call still requests fresh announcements
 * so extensions installed or enabled after page load can appear in the modal.
 */
export function discoverWalletProviders(): void {
  if (typeof window === 'undefined') return

  if (!discoveryStarted) {
    window.addEventListener('eip6963:announceProvider', ((event: CustomEvent<Eip6963ProviderDetail>) => {
      const detail = event.detail
      if (!detail?.provider || !detail.info) return
      registerProvider(detail.provider, detail.info)
    }) as EventListener)
    discoveryStarted = true
  }

  const injectedWindow = window as InjectedWindow
  const legacyProviders = injectedWindow.ethereum?.providers?.length
    ? injectedWindow.ethereum.providers
    : injectedWindow.ethereum
      ? [injectedWindow.ethereum]
      : []

  legacyProviders.forEach((provider, index) => {
    registerProvider(provider, { name: legacyProviderName(provider, index) })
  })

  if (injectedWindow.uniswap) {
    registerProvider(injectedWindow.uniswap, {
      name: 'Uniswap Extension',
      rdns: 'org.uniswap',
    })
  }

  // EIP-6963 wallets respond to this event with announceProvider events.
  window.dispatchEvent(new Event('eip6963:requestProvider'))
}

/** Return an immutable snapshot suitable for rendering a wallet picker. */
export function walletProviders(): WalletProvider[] {
  return [...providers.values()].sort((a, b) => {
    // Put Uniswap first because it is a required wallet for this feature lab.
    const aIsUniswap = /uniswap/i.test(`${a.name} ${a.rdns ?? ''}`)
    const bIsUniswap = /uniswap/i.test(`${b.name} ${b.rdns ?? ''}`)
    if (aIsUniswap !== bIsUniswap) return aIsUniswap ? -1 : 1
    return a.name.localeCompare(b.name)
  })
}

/** Subscribe to late or refreshed EIP-6963 announcements. */
export function onWalletProvidersChanged(listener: () => void): () => void {
  providerListeners.add(listener)
  return () => providerListeners.delete(listener)
}

export function hasWallet(): boolean {
  if (providers.size > 0) return true
  if (typeof window === 'undefined') return false
  const injectedWindow = window as InjectedWindow
  return Boolean(injectedWindow.ethereum || injectedWindow.uniswap)
}

export function selectedWalletProviderId(): string | null {
  return storedProviderId()
}

function selectedProvider(): WalletProvider | undefined {
  const id = storedProviderId()
  return id ? providers.get(id) : undefined
}

/** Select a provider for all subsequent reads, switches, and transactions. */
function selectProvider(id: string): WalletProvider {
  const provider = providers.get(id)
  if (!provider) throw new Error('That wallet is no longer available. Refresh and try again.')
  selectedProviderIdMemory = id
  try {
    localStorage.removeItem(SELECTED_PROVIDER_KEY)
    if (provider.rdns) localStorage.setItem(SELECTED_RDNS_KEY, provider.rdns)
    else localStorage.removeItem(SELECTED_RDNS_KEY)
  } catch {
    // The in-memory registry still supports this page session in private mode.
  }
  return provider
}

function requireSelectedProvider(): Eip1193Provider {
  const wallet = selectedProvider()
  if (!wallet) throw new Error('Choose a browser wallet to continue.')
  return wallet.provider
}

export function walletClient() {
  return createWalletClient({ transport: custom(requireSelectedProvider()) })
}

// Use this only for wallet-specific reads such as gas estimation. Receipt and
// contract-state reads use the independent chain client, including on Uniswap.
export function walletPublicClient(chain: Chain) {
  return createPublicClient({ chain, transport: custom(requireSelectedProvider()) })
}

/** Prompt for accounts through one explicit provider from the wallet modal. */
export async function connect(providerId: string): Promise<Address> {
  const provider = providers.get(providerId)
  if (!provider) throw new Error('That wallet is no longer available.')
  const client = createWalletClient({ transport: custom(provider.provider) })
  const addresses = await client.requestAddresses()
  if (!addresses[0]) throw new Error('No account authorized.')
  selectProvider(providerId)
  return addresses[0]
}

/**
 * Disconnect This application locally. Browser extensions do not expose a consistent,
 * permission-safe disconnect RPC, so clearing the selected provider is the
 * interoperable dapp behavior and never locks or alters the wallet itself.
 */
export function disconnect(): void {
  selectedProviderIdMemory = null
  try {
    localStorage.removeItem(SELECTED_PROVIDER_KEY)
    localStorage.removeItem(SELECTED_RDNS_KEY)
  } catch {
    // No persisted selection exists in private mode.
  }
}

// Read already-authorized accounts without prompting. No provider is consulted
// after a local disconnect, which prevents an authorized extension from silently
// reconnecting the This application UI on the next render.
export async function currentAccounts(): Promise<Address[]> {
  try {
    return await walletClient().getAddresses()
  } catch {
    return []
  }
}

export async function currentChainId(): Promise<number | undefined> {
  try {
    return await walletClient().getChainId()
  } catch {
    return undefined
  }
}

/** Stop if the user changed accounts while a confirmation dialog was open. */
export async function assertWalletAccount(expected: Address): Promise<void> {
  const accounts = await walletClient().getAddresses()
  if (accounts[0]?.toLowerCase() !== expected.toLowerCase()) {
    throw new Error('Wallet account changed. Reconnect the original account before continuing.')
  }
}

// Ensure the wallet is on `chain`; switch, and add it first if the wallet does
// not know it. The selected provider is shared with every deposit helper.
export async function ensureChain(chain: Chain): Promise<void> {
  const client = walletClient()
  const current = await client.getChainId()
  if (current === chain.id) return
  try {
    await client.switchChain({ id: chain.id })
  } catch (error) {
    // viem wraps EIP-1193 errors; 4902 can live several causes below the top.
    let nested: unknown = error
    let code: number | undefined
    for (let depth = 0; nested && depth < 8; depth++) {
      const detail = nested as { code?: number; cause?: unknown }
      if (detail.code === 4902) { code = 4902; break }
      nested = detail.cause
    }
    const notAdded = code === 4902 || /unrecognized chain|not been added|addEthereumChain/i.test(String(error))
    if (notAdded && chain.rpcUrls.default.http[0]) {
      await client.addChain({ chain })
      await client.switchChain({ id: chain.id })
    } else {
      throw error
    }
  }
  if (await client.getChainId() !== chain.id) throw new Error('Wallet did not switch to the requested network.')
}

/** Subscribe only to the provider currently selected in the wallet modal. */
export function onWalletChange(callback: () => void): () => void {
  const provider = selectedProvider()?.provider
  if (!provider?.on) return () => {}
  provider.on('accountsChanged', callback)
  provider.on('chainChanged', callback)
  provider.on('disconnect', callback)
  return () => {
    provider.removeListener?.('accountsChanged', callback)
    provider.removeListener?.('chainChanged', callback)
    provider.removeListener?.('disconnect', callback)
  }
}
