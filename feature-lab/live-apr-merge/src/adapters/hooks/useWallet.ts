import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type Address } from 'viem'
import {
  connect,
  currentAccounts,
  currentChainId,
  disconnect,
  discoverWalletProviders,
  onWalletChange,
  onWalletProvidersChanged,
  selectedWalletProviderId,
  walletProviders,
  type WalletProvider,
} from '../wallet/wallet'

type PendingConnection = {
  promise: Promise<void>
  resolve: () => void
  reject: (error: Error) => void
}

/**
 * Own This application's portable wallet-picker state.
 *
 * EIP-6963 providers can announce after React mounts, so discovery and account
 * state are subscribed independently. Deposit modals may await `connect()`;
 * that promise resolves only after the user selects and authorizes a wallet.
 */
export function useWallet() {
  const [account, setAccount] = useState<Address | null>(null)
  const [chainId, setChainId] = useState<number | undefined>(undefined)
  const [providers, setProviders] = useState<WalletProvider[]>(() => walletProviders())
  const [activeProviderId, setActiveProviderId] = useState<string | null>(() => selectedWalletProviderId())
  const [modalOpen, setModalOpen] = useState(false)
  const [connectingProviderId, setConnectingProviderId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pendingConnection = useRef<PendingConnection | null>(null)
  const readVersion = useRef(0)

  const readState = useCallback(async () => {
    const version = ++readVersion.current
    const selection = selectedWalletProviderId()
    const [addresses, connectedChainId] = await Promise.all([currentAccounts(), currentChainId()])
    // Ignore replies from a wallet that was disconnected or replaced while
    // its asynchronous account/chain reads were still in flight.
    if (version !== readVersion.current || selection !== selectedWalletProviderId()) return
    setAccount(addresses[0] ?? null)
    setChainId(connectedChainId)
  }, [])

  const refreshProviders = useCallback(() => {
    // Requesting providers again lets a newly enabled extension announce
    // without forcing the user to reload the whole application.
    discoverWalletProviders()
    setProviders(walletProviders())
  }, [])

  useEffect(() => {
    const syncProviders = () => {
      setProviders(walletProviders())
      setActiveProviderId(selectedWalletProviderId())
    }
    const unsubscribe = onWalletProvidersChanged(syncProviders)
    discoverWalletProviders()
    syncProviders()
    return unsubscribe
  }, [])

  useEffect(() => {
    if (!activeProviderId || !providers.some((provider) => provider.id === activeProviderId)) {
      setAccount(null)
      setChainId(undefined)
      return
    }
    void readState()
    return onWalletChange(() => void readState())
  }, [activeProviderId, providers, readState])

  useEffect(() => {
    const resume = () => {
      if (document.hidden) return
      refreshProviders()
      void readState()
    }
    window.addEventListener('focus', resume)
    window.addEventListener('pageshow', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      readVersion.current++
      window.removeEventListener('focus', resume)
      window.removeEventListener('pageshow', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [readState, refreshProviders])

  const openModal = useCallback(() => {
    setError(null)
    setModalOpen(true)
    refreshProviders()
  }, [refreshProviders])

  const closeModal = useCallback(() => {
    if (connectingProviderId) return
    setModalOpen(false)
    setError(null)
    if (pendingConnection.current) {
      pendingConnection.current.reject(new Error('Wallet connection cancelled.'))
      pendingConnection.current = null
    }
  }, [connectingProviderId])

  const requestConnection = useCallback((): Promise<void> => {
    if (account) return Promise.resolve()
    if (pendingConnection.current) return pendingConnection.current.promise

    setError(null)
    setModalOpen(true)
    refreshProviders()

    let resolvePromise!: () => void
    let rejectPromise!: (error: Error) => void
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve
      rejectPromise = reject
    })
    pendingConnection.current = {
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
    }
    return promise
  }, [account, refreshProviders])

  const connectProvider = useCallback(async (providerId: string) => {
    setConnectingProviderId(providerId)
    setError(null)
    try {
      const address = await connect(providerId)
      setActiveProviderId(providerId)
      setAccount(address)
      setChainId(await currentChainId())
      setModalOpen(false)
      pendingConnection.current?.resolve()
      pendingConnection.current = null
    } catch (connectionError) {
      const message = connectionError instanceof Error ? connectionError.message : 'Unable to connect wallet.'
      setError(message.split('\n')[0].slice(0, 180))
    } finally {
      setConnectingProviderId(null)
    }
  }, [])

  const disconnectWallet = useCallback(() => {
    readVersion.current++
    disconnect()
    setAccount(null)
    setChainId(undefined)
    setActiveProviderId(null)
    setModalOpen(false)
    setError(null)
    if (pendingConnection.current) {
      pendingConnection.current.reject(new Error('Wallet disconnected.'))
      pendingConnection.current = null
    }
  }, [])

  const activeProvider = useMemo(
    () => providers.find((provider) => provider.id === activeProviderId) ?? null,
    [activeProviderId, providers],
  )

  return {
    account,
    chainId,
    providers,
    activeProvider,
    modalOpen,
    connecting: connectingProviderId !== null,
    connectingProviderId,
    error,
    available: providers.length > 0,
    connect: requestConnection,
    connectProvider,
    disconnect: disconnectWallet,
    openModal,
    closeModal,
    refreshProviders,
  }
}
