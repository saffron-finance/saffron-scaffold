import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
const wallet=vi.hoisted(()=>({account:'0x1111111111111111111111111111111111111111',chain:4663,selected:'wallet',read:vi.fn(),listeners:new Set<()=>void>()}))
vi.mock('../wallet/wallet',()=>({
  connect:vi.fn(),cancelWalletConnection:vi.fn(),disconnect:async()=>{wallet.selected=''},
  currentAccounts:async()=>{wallet.read();return wallet.selected?[wallet.account]:[]},currentChainId:async()=>wallet.chain,
  selectedWalletProviderId:()=>wallet.selected,walletProviders:()=>[{id:'wallet',name:'Wallet'}],
  discoverWalletProviders:vi.fn(),onWalletChange:()=>()=>{},
  onWalletProvidersChanged:(fn:()=>void)=>{wallet.listeners.add(fn);return()=>wallet.listeners.delete(fn)},
}))
import { useWallet } from './useWallet'
import { connect, cancelWalletConnection } from '../wallet/wallet'
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


test('cancelling ignores late wallet permission and resolves no pending application action',async()=>{
  let approve!: (value: `0x${string}`)=>void
  vi.mocked(connect).mockImplementation(()=>new Promise(resolve=>{approve=resolve}))
  wallet.selected=''
  const {result,unmount}=renderHook(()=>useWallet())
  let pending!: Promise<void>
  act(()=>{pending=result.current.connect()})
  const rejection=expect(pending).rejects.toThrow('cancelled')
  let attempt!: Promise<void>
  act(()=>{attempt=result.current.connectProvider('wallet')})
  act(()=>result.current.closeModal())
  await rejection
  await act(async()=>{approve('0x1111111111111111111111111111111111111111');await attempt})
  expect(result.current.account).toBeNull()
  expect(result.current.modalOpen).toBe(false)
  expect(cancelWalletConnection).toHaveBeenCalled()
  unmount()
})

test('double clicks prompt once and unmount cancels an outstanding connection',async()=>{
  vi.mocked(connect).mockClear()
  vi.mocked(connect).mockImplementation(()=>new Promise(()=>{}))
  const {result,unmount}=renderHook(()=>useWallet())
  act(()=>{void result.current.connectProvider('wallet');void result.current.connectProvider('wallet')})
  expect(connect).toHaveBeenCalledOnce()
  vi.mocked(cancelWalletConnection).mockClear()
  unmount()
  expect(cancelWalletConnection).toHaveBeenCalledOnce()
})
