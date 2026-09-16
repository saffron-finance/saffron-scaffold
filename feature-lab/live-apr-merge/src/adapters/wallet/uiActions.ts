import type { Account, Chain, Client, PublicActions, Transport, WalletActions } from 'viem'
import {
  addChain, estimateGas, getAddresses, getBalance, getBlock, getBlockNumber,
  getChainId, getTransaction, getTransactionCount, readContract, requestAddresses,
  sendTransaction, signMessage, switchChain, waitForTransactionReceipt,
} from 'viem/actions'

/** Bind only the viem actions the browser actually uses. These are viem's own
 * implementations, with their original generic types and error handling—not
 * replacement RPC logic. Full client decorators retain many unused APIs in the
 * startup bundle. Keep this list aligned with consumers when adding features;
 * never remove transport/preflight checks to reduce bundle size. */
export function catalogReadActions<T extends Transport, C extends Chain | undefined, A extends Account | undefined>(client: Client<T,C,A>):
  Pick<PublicActions<T,C,A>, 'readContract'|'getBalance'|'getBlock'|'getBlockNumber'|'getTransaction'|'getTransactionCount'|'waitForTransactionReceipt'> {
  return {
    readContract: args => readContract(client,args),
    getBalance: args => getBalance(client,args),
    getBlock: args => getBlock(client,args),
    getBlockNumber: args => getBlockNumber(client,args),
    getTransaction: args => getTransaction(client,args),
    getTransactionCount: args => getTransactionCount(client,args),
    waitForTransactionReceipt: args => waitForTransactionReceipt(client,args),
  }
}

/** Wallet-specific silent reads retain the caller's bounded, no-retry transport. */
export function walletReadActions<T extends Transport, C extends Chain | undefined, A extends Account | undefined>(client: Client<T,C,A>):
  Pick<PublicActions<T,C,A>, 'estimateGas'|'getTransactionCount'|'getChainId'> {
  return {
    estimateGas: args => estimateGas(client,args),
    getTransactionCount: args => getTransactionCount(client,args),
    getChainId: () => getChainId(client),
  }
}

/** Preserve wallet prompts and viem's send/sign/switch semantics exactly. The
 * provider wrapper still owns single submission and durable recovery boundaries. */
export function uiWalletActions<T extends Transport, C extends Chain | undefined, A extends Account | undefined>(client: Client<T,C,A>):
  Pick<WalletActions<C,A>, 'addChain'|'getAddresses'|'getChainId'|'requestAddresses'|'sendTransaction'|'signMessage'|'switchChain'> {
  return {
    addChain: args => addChain(client,args),
    getAddresses: () => getAddresses(client),
    getChainId: () => getChainId(client),
    requestAddresses: () => requestAddresses(client),
    sendTransaction: args => sendTransaction(client,args),
    signMessage: args => signMessage(client,args),
    switchChain: args => switchChain(client,args),
  }
}
