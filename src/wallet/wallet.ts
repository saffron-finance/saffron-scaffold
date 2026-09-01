import { createWalletClient, createPublicClient, custom, type Address, type Chain } from 'viem'

// Minimal EIP-1193 wallet integration (MetaMask / any injected wallet) built directly on viem — no
// extra dependency. All writes go through the user's own wallet provider; reads/receipt-waits during a
// deposit also use the wallet's provider (it is already on the right chain), so they never touch the
// read-only dashboard proxy.

type Eip1193 = { request: (args: { method: string; params?: unknown[] }) => Promise<unknown> }

function injected(): Eip1193 | undefined {
  return typeof window !== 'undefined' ? (window as unknown as { ethereum?: Eip1193 }).ethereum : undefined
}

export function hasWallet(): boolean {
  return !!injected()
}

export function walletClient() {
  const eth = injected()
  if (!eth) throw new Error('No browser wallet found. Install MetaMask (or another wallet) to deposit.')
  return createWalletClient({ transport: custom(eth) })
}

// A public client over the WALLET's provider — used for allowance reads and receipt waits during a
// deposit, since the wallet is already connected to the target chain.
export function walletPublicClient(chain: Chain) {
  const eth = injected()
  if (!eth) throw new Error('No browser wallet found.')
  return createPublicClient({ chain, transport: custom(eth) })
}

export async function connect(): Promise<Address> {
  const addrs = await walletClient().requestAddresses()
  if (!addrs[0]) throw new Error('No account authorized.')
  return addrs[0]
}

// Already-authorized accounts, without prompting (empty if not connected).
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

// Ensure the wallet is on `chain`; switch, and add it first if the wallet does not know it.
export async function ensureChain(chain: Chain): Promise<void> {
  const wc = walletClient()
  const current = await wc.getChainId()
  if (current === chain.id) return
  try {
    await wc.switchChain({ id: chain.id })
  } catch (err) {
    const code = (err as { code?: number })?.code
    const notAdded = code === 4902 || /unrecognized chain|not been added|addEthereumChain/i.test(String(err))
    if (notAdded && chain.rpcUrls.default.http[0]) {
      await wc.addChain({ chain })
      await wc.switchChain({ id: chain.id })
    } else {
      throw err
    }
  }
}

// Subscribe to account / chain changes so the UI can react.
export function onWalletChange(cb: () => void): () => void {
  const eth = injected() as (Eip1193 & { on?: (e: string, h: () => void) => void; removeListener?: (e: string, h: () => void) => void }) | undefined
  if (!eth?.on) return () => {}
  eth.on('accountsChanged', cb)
  eth.on('chainChanged', cb)
  return () => {
    eth.removeListener?.('accountsChanged', cb)
    eth.removeListener?.('chainChanged', cb)
  }
}
