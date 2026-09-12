import { EthereumProvider } from '@walletconnect/ethereum-provider'
import { setExternalWalletOpen } from '../../../vendor/fixed-income-ui/shared/components/Modal'
import { robinhoodChain } from '../chain/chains'
import type { WalletConnectConfig, WalletConnectSdk } from './walletconnect'

/** Loaded only after choosing WalletConnect or restoring its accepted session.
 * Use AppKit Core solely for pairing/QR/mobile links; the application continues
 * to own accounts, network checks, transactions and payment recovery. */
export async function createWalletConnectSdk(config: WalletConnectConfig): Promise<WalletConnectSdk> {
  const rpc = new URL('rpc/robinhood', config.baseUrl).href
  const metadata = { name: 'Saffron liquidity incentives', description: 'Fixed-side liquidity incentive vaults',
    url: new URL(config.baseUrl).origin, icons: [] }
  const provider = await EthereumProvider.init({
    projectId: config.projectId, metadata, showQrModal: false, optionalChains: [4663],
    optionalMethods: ['eth_sendTransaction', 'personal_sign', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'],
    optionalEvents: ['accountsChanged', 'chainChanged'], rpcMap: { 4663: rpc },
    customStoragePrefix: 'saffron-incentives:' + new URL(config.baseUrl).pathname,
    telemetryEnabled: false, disableProviderPing: true,
  })
  let modal: import('@reown/appkit/core').AppKit | undefined
  async function getModal() {
    if (modal) return modal
    const { createAppKit } = await import('@reown/appkit/core')
    modal = createAppKit({ projectId: config.projectId, metadata,
      networks: [{ ...robinhoodChain, rpcUrls: { default: { http: [rpc] } } }],
      universalProvider: provider.signer as unknown as NonNullable<import('@reown/appkit/core').AppKitOptions['universalProvider']>,
      manualWCControl: true, enableEIP6963: false, enableInjected: false, enableCoinbase: false,
      enableWalletConnect: true, enableNetworkSwitch: false, enableMobileFullScreen: true,
      themeMode: 'dark', themeVariables: { '--w3m-z-index': 100 },
      features: { analytics: false, email: false, socials: false, swaps: false, onramp: false,
        history: false, send: false, receive: false },
    })
    await modal.ready()
    return modal
  }
  return {
    provider: {
      request: args => provider.request(args),
      on: (event, fn) => { provider.on(event as 'accountsChanged', fn) },
      removeListener: (event, fn) => { provider.removeListener(event as 'accountsChanged', fn) },
    },
    session: () => provider.session,
    async connect(onCancel, signal) {
      const ui = await getModal()
      if (signal.aborted) throw new Error('Wallet connection cancelled.')
      const close = () => { setExternalWalletOpen(false); void ui.close() }
      signal.addEventListener('abort', close, { once: true })
      let opened = false
      const unsubscribe = ui.subscribeState(state => {
        if (state.open) opened = true
        else if (opened && !provider.session) onCancel()
      })
      const display = (uri: string) => { if (!signal.aborted) void ui.open({ uri }).catch(onCancel) }
      provider.on('display_uri', display)
      try {
        setExternalWalletOpen(true)
        await ui.open({ view: 'Connect' })
        if (signal.aborted) throw new Error('Wallet connection cancelled.')
        await provider.connect()
      } finally {
        unsubscribe(); provider.removeListener('display_uri', display)
        signal.removeEventListener('abort', close)
        setExternalWalletOpen(false)
        await ui.close()
      }
    },
    closeModal() { if (modal) void modal.close() },
    async disconnect() { if (modal) await modal.close(); if (provider.session) await provider.disconnect() },
  }
}
