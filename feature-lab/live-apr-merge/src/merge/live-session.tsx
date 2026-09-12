import { walletConnectConfigured } from '@lab/wallet/walletconnect'
import { useWallet } from '@lab/hooks/useWallet'
import { WalletList,WalletButton } from '../host/AppShell'
import { Modal,ModalTitle } from '../host/ui'

/** Every build discovers an actual wallet. Connection and transaction approval
 * remain with that wallet on both local-chain and production deployments. */
export function useMergeSession(){
  const wallet=useWallet()
  return {account:wallet.account,openModal:wallet.openModal,
    overlays:wallet.modalOpen?<Modal isOpen layer='wallet' onRequestClose={wallet.closeModal} shouldCloseOnOverlayClick={!wallet.connecting}>
      <ModalTitle>Connect wallet</ModalTitle><WalletList>
        {wallet.providers.map(provider=><WalletButton key={provider.id} disabled={wallet.connecting} onClick={()=>void wallet.connectProvider(provider.id)}>{provider.name}{wallet.connectingProviderId===provider.id?', connecting…':''}</WalletButton>)}
        {!walletConnectConfigured&&<><WalletButton disabled>WalletConnect unavailable</WalletButton><p>Use a wallet extension or open this page in your wallet’s browser to connect.</p></>}
        {wallet.providers.some(provider => provider.kind === 'walletconnect') && <p>WalletConnect opens your mobile wallet or shows a QR code. Choose a wallet that supports Robinhood Chain.</p>}
        {!wallet.available&&<p>Open this page in your wallet browser or enable a wallet extension.</p>}
        {wallet.error&&<p role='alert'>{wallet.error}</p>}
        <WalletButton disabled={wallet.connecting} onClick={wallet.refreshProviders}>Refresh wallets</WalletButton>
        {wallet.account&&<WalletButton disabled={wallet.connecting} onClick={wallet.disconnect}>Disconnect wallet</WalletButton>}
        <WalletButton onClick={wallet.closeModal}>{wallet.connecting ? 'Cancel connection' : 'Close'}</WalletButton>
      </WalletList></Modal>:null}
}
