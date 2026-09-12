import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
const wallet=vi.hoisted(()=>({account:'0x1111111111111111111111111111111111111111',chain:4663,selected:'wallet',read:vi.fn(),listeners:new Set<()=>void>()}))
vi.mock('../wallet/wallet',()=>({
  connect:vi.fn(),disconnect:()=>{wallet.selected=''},
  currentAccounts:async()=>{wallet.read();return wallet.selected?[wallet.account]:[]},currentChainId:async()=>wallet.chain,
  selectedWalletProviderId:()=>wallet.selected,walletProviders:()=>[{id:'wallet',name:'Wallet'}],
  discoverWalletProviders:vi.fn(),onWalletChange:()=>()=>{},
  onWalletProvidersChanged:(fn:()=>void)=>{wallet.listeners.add(fn);return()=>wallet.listeners.delete(fn)},
}))
import { useWallet } from './useWallet'
afterEach(()=>{wallet.selected='wallet';wallet.chain=4663;wallet.read.mockClear()})
test('return from a wallet browser rereads account and chain without a connection prompt',async()=>{
  const {result,unmount}=renderHook(()=>useWallet())
  await waitFor(()=>expect(result.current.chainId).toBe(4663))
  wallet.account='0x2222222222222222222222222222222222222222';wallet.chain=1
  act(()=>window.dispatchEvent(new Event('pageshow')))
  await waitFor(()=>{expect(result.current.account).toBe(wallet.account);expect(result.current.chainId).toBe(1)})
  act(()=>result.current.disconnect())
  act(()=>window.dispatchEvent(new Event('focus')))
  await waitFor(()=>expect(result.current.account).toBeNull())
  unmount();wallet.read.mockClear()
  window.dispatchEvent(new Event('pageshow'))
  expect(wallet.read).not.toHaveBeenCalled()
})
