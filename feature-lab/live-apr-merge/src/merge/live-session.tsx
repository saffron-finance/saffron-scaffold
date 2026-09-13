import { walletConnectConfigured } from '@lab/wallet/walletconnect'
import { useWallet } from '@lab/hooks/useWallet'
import { HeaderDialog, HeaderIcon, WalletOption, DialogAction, WalletDetails } from '../host/HeaderDialogs'

/** Restyle the real provider picker, never copy the reference's example-wallet
 * simulation. Discovery, pending cancellation and QR handoff stay unchanged. */
export function useMergeSession(){
  const wallet=useWallet()
  return {account:wallet.account,chainId:wallet.chainId,openModal:wallet.openModal,
    overlays:wallet.modalOpen?<HeaderDialog title={wallet.account?'Your wallet':'Connect wallet'} wallet onClose={wallet.closeModal} pending={wallet.connecting}>
      <p>{wallet.account?'Manage your connection or choose another wallet.':'Choose a wallet to connect to Saffron. You approve every transaction in your wallet.'}</p>
      {wallet.account&&<WalletDetails><small>Connected address</small>{wallet.account}</WalletDetails>}
      {wallet.providers.map(provider=><WalletOption key={provider.id} aria-label={provider.name} disabled={wallet.connecting} onClick={()=>void wallet.connectProvider(provider.id)}>
        {provider.icon?.startsWith('data:image/')?<img src={provider.icon} alt=''/>:<HeaderIcon name='wallet'/>}
        <span>{provider.name}<small>{wallet.connectingProviderId===provider.id?'Waiting for your wallet…':provider.kind==='walletconnect'?'Scan a QR code or open your mobile wallet':'Browser wallet · approve the connection'}</small></span><HeaderIcon name='arrow'/>
      </WalletOption>)}
      {!walletConnectConfigured&&<WalletOption disabled><HeaderIcon name='wallet'/><span>WalletConnect<small>QR connection is not configured on this site</small></span></WalletOption>}
      {!wallet.available&&<p>Open this page in your wallet browser or enable a wallet extension.</p>}
      {wallet.error&&<p role='alert'>{wallet.error}</p>}
      <DialogAction disabled={wallet.connecting} onClick={wallet.refreshProviders}><HeaderIcon name='refresh'/>Refresh wallets</DialogAction>
      {wallet.account&&<DialogAction disabled={wallet.connecting} onClick={wallet.disconnect}>Disconnect wallet</DialogAction>}
      {wallet.connecting&&<DialogAction onClick={wallet.closeModal}>Cancel connection</DialogAction>}
    </HeaderDialog>:null}
}
