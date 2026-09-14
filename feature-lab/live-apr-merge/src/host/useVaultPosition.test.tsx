import {act,cleanup,renderHook} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {Address} from 'viem'

// Use the real selected-provider adapter and viem transport. Only the read-only
// backend and contract snapshot are fixtures; no keys, RPC or real wallet sends.
const mocks=vi.hoisted(()=>({context:vi.fn(),receipt:vi.fn(),request:vi.fn(),transaction:vi.fn(),block:vi.fn()}))
vi.mock('@lab/wallet/walletconnect',()=>({WALLETCONNECT_ID:'wallet:walletconnect',WALLETCONNECT_RDNS:'org.walletconnect',walletConnectConfigured:false}))
vi.mock('./transport',()=>({
  requestJson:mocks.context,authedJson:vi.fn(),readSession:vi.fn(async()=>({operator:true})),
  robinhoodClient:{waitForTransactionReceipt:mocks.receipt,getTransaction:mocks.transaction,getBlock:mocks.block},
}))
vi.mock('../../shared/vault-lifecycle.mjs',()=>({abi:[],WETH:'0x'+'33'.repeat(20),eligibility:()=>({state:'ready'}),sameAddress:(a:string,b:string)=>a?.toLowerCase()===b?.toLowerCase()}))
vi.mock('../../shared/position-actions.mjs',()=>({positionAction:()=>({stage:'claim',label:'Claim',to:'0x'+'22'.repeat(20),data:'0x1234',value:0n,amounts:[1n,0n]})}))
import {connect,discoverWalletProviders,walletProviders,disconnect,walletPublicClient} from '@lab/wallet/wallet'
import {robinhoodChain} from '@lab/chain/chains'
import {WALLET_READ_TIMEOUT_MS} from '@lab/wallet/preflight'
import {useVaultPosition,positionStorageKey} from './useVaultPosition'
import {readIntentRecord,writeIntentRecord} from './position-intent'

const account=('0x'+'11'.repeat(20)) as Address
const txHash='0x'+'aa'.repeat(32)
const locks=new Set<string>()
const token={address:'0x'+'44'.repeat(20),decimals:18,symbol:'TEST'}
const snapshot={token0:token,token1:token}
const calls=(method:string)=>mocks.request.mock.calls.filter(([args])=>args.method===method)
const flush=()=>act(async()=>{await vi.advanceTimersByTimeAsync(0)})
function deferred<T>(){let resolve!:(v:T)=>void;let reject!:(e:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b});return{promise,resolve,reject}}
const standard=async({method}:{method:string})=>{
  if(method==='eth_requestAccounts'||method==='eth_accounts')return[account]
  if(method==='eth_chainId')return'0x1237'
  if(method==='eth_estimateGas')return'0x5208'
  if(method==='eth_getTransactionCount')return'0x3'
  if(method==='eth_sendTransaction')return txHash
  throw new Error('Unexpected wallet method: '+method)
}

beforeEach(async()=>{
  vi.useFakeTimers();localStorage.clear();locks.clear()
  mocks.context.mockReset().mockResolvedValue({snapshot})
  mocks.receipt.mockReset().mockRejectedValue(new Error('Receipt pending; recovery retained.'))
  mocks.request.mockReset().mockImplementation(standard)
  mocks.transaction.mockReset().mockResolvedValue({from:account,to:'0x'+'22'.repeat(20),input:'0x1234',value:0n,nonce:3})
  mocks.block.mockReset().mockResolvedValue({hash:'0x'+'bb'.repeat(32)})
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn(async(name:string,_options:unknown,callback:(lock:any)=>Promise<void>)=>{
    if(locks.has(name))return callback(null)
    locks.add(name)
    try{return await callback({name})}finally{locks.delete(name)}
  })}})
  Object.defineProperty(window,'ethereum',{configurable:true,value:{request:mocks.request,isMetaMask:true}})
  discoverWalletProviders()
  await connect(walletProviders().find(wallet=>wallet.name==='MetaMask')!.id)
})

describe('cross-tab intent ownership',()=>{
  const key=positionStorageKey(account,'vault-a')
  const old={actionId:'first',stage:'claim',account,deploymentId:'vault-a',to:'0x'+'22'.repeat(20),data:'0x1234',value:'0',nonce:3,hash:txHash}
  const newer={...old,actionId:'next',nonce:4,hash:'0x'+'cc'.repeat(32)}
  it.each([undefined,'0x'+'dd'.repeat(32)])('refuses stale recovery or manual hash edits against a newer intent',async hash=>{
    localStorage.setItem(key,JSON.stringify(old))
    const view=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    // A suspended/background tab may not have received its storage event yet.
    localStorage.setItem(key,JSON.stringify(newer))
    await act(async()=>{await view.result.current.recover(hash as any)})
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(newer)
    expect(view.result.current.pending).toEqual(newer)
    expect(view.result.current.error).toMatch(/changed in another tab/)
    expect(mocks.receipt).not.toHaveBeenCalled();expect(calls('eth_sendTransaction')).toHaveLength(0)
  })
  it('uses the send lock during recovery and blocks overlapping actions',async()=>{
    localStorage.setItem(key,JSON.stringify(old))
    const held=deferred<any>();mocks.receipt.mockReturnValue(held.promise)
    const first=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    let task!:Promise<void>;await act(async()=>{task=first.result.current.recover()});await flush()
    expect(locks.size).toBe(1)
    const second=renderHook(()=>useVaultPosition(account,'vault-b','claim'));await flush()
    await act(async()=>{await second.result.current.advance()})
    expect(second.result.current.error).toMatch(/Another Saffron wallet action/)
    expect(calls('eth_sendTransaction')).toHaveLength(0)
    held.reject(Error('Still pending'));await act(async()=>{await task})
    expect(locks.size).toBe(0);expect(JSON.parse(localStorage.getItem(key)!)).toEqual(old)
  })
  it('a late confirmation cannot remove a record replaced by an older uncoordinated client',async()=>{
    localStorage.setItem(key,JSON.stringify(old))
    const held=deferred<any>();mocks.receipt.mockReturnValue(held.promise)
    const view=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    let task!:Promise<void>;await act(async()=>{task=view.result.current.recover()});await flush()
    localStorage.setItem(key,JSON.stringify(newer))
    held.resolve({status:'success',blockNumber:1n,blockHash:'0x'+'bb'.repeat(32),logs:[]})
    await act(async()=>{await task})
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(newer)
    expect(view.result.current.error).toMatch(/changed in another tab/)
    expect(view.result.current.completed).toBe(false)
  })
  it('notifies other controllers in this tab and accepts legacy records without migration',async()=>{
    const {actionId,...legacy}=old
    localStorage.setItem(key,JSON.stringify(legacy))
    const view=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    const before=readIntentRecord(key,account,'vault-a')
    await act(async()=>{writeIntentRecord(key,before,newer as any)})
    expect(view.result.current.pending).toEqual(newer)
    expect(()=>writeIntentRecord(key,before,null)).toThrow(/changed in another tab/)
    expect(JSON.parse(localStorage.getItem(key)!)).toEqual(newer)
  })
})
afterEach(async()=>{cleanup();await disconnect();vi.useRealTimers()})

describe('revocable wallet preparation',()=>{
  it.each(['eth_estimateGas','eth_getTransactionCount','eth_accounts','eth_chainId'])('bounds a stalled %s, releases the shared lock and never sends a late result',async(method)=>{
    const held=deferred<unknown>()
    mocks.request.mockImplementation(args=>args.method===method?held.promise:standard(args))
    const {result}=renderHook(()=>useVaultPosition(account,'vault-a','claim'))
    await flush()
    let task!:Promise<void>
    await act(async()=>{task=result.current.advance()});await flush()
    expect(result.current.busy).toBe(true);expect(result.current.closeBlocked).toBe(false)
    expect(locks.size).toBe(1)
    await act(async()=>{await vi.advanceTimersByTimeAsync(WALLET_READ_TIMEOUT_MS+1);await task})
    expect(result.current.busy).toBe(false);expect(locks.size).toBe(0)
    expect(result.current.error).toMatch(/timed out/i)
    expect(calls(method)).toHaveLength(1) // no transport retry storm
    expect(localStorage.getItem(positionStorageKey(account,'vault-a'))).toBeNull()
    held.resolve(await standard({method}));await flush()
    await act(async()=>{await vi.advanceTimersByTimeAsync(5*60_000)})
    expect(calls('eth_sendTransaction')).toHaveLength(0)
    // A new explicit action in another Saffron dialog can now acquire the lock.
    mocks.request.mockImplementation(standard)
    const other=renderHook(()=>useVaultPosition(account,'vault-b','claim'));await flush()
    await act(async()=>{await other.result.current.advance()})
    expect(calls('eth_sendTransaction')).toHaveLength(1)
    expect(other.result.current.pending?.hash).toBe(txHash)
  })

  it('closing before the deadline releases immediately and ignores a late estimate after reopening',async()=>{
    const held=deferred<unknown>()
    mocks.request.mockImplementation(args=>args.method==='eth_estimateGas'?held.promise:standard(args))
    const view=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    let task!:Promise<void>
    await act(async()=>{task=view.result.current.advance()});await flush()
    view.unmount();await act(async()=>{await task})
    expect(locks.size).toBe(0);expect(calls('eth_sendTransaction')).toHaveLength(0)
    mocks.request.mockImplementation(standard)
    const reopened=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    await act(async()=>{await reopened.result.current.advance()})
    held.resolve('0x5208');await flush()
    expect(calls('eth_sendTransaction')).toHaveLength(1)
    expect(reopened.result.current.pending?.hash).toBe(txHash)
  })

  it('changing the reviewed account revokes the old action',async()=>{
    const held=deferred<unknown>()
    mocks.request.mockImplementation(args=>args.method==='eth_estimateGas'?held.promise:standard(args))
    const view=renderHook(({wallet})=>useVaultPosition(wallet,'vault-a','claim'),{initialProps:{wallet:account}});await flush()
    let task!:Promise<void>
    await act(async()=>{task=view.result.current.advance()});await flush()
    view.rerender({wallet:('0x'+'55'.repeat(20)) as Address});await act(async()=>{await task})
    held.resolve('0x5208');await flush()
    expect(locks.size).toBe(0);expect(calls('eth_sendTransaction')).toHaveLength(0)
  })

  it('ignores a cancelled context response without changing the new review',async()=>{
    const held=deferred<any>()
    const view=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    mocks.context.mockReturnValueOnce(held.promise)
    let task!:Promise<void>
    await act(async()=>{task=view.result.current.advance()});await flush()
    await act(async()=>{view.result.current.cancelPreflight();await task})
    expect(locks.size).toBe(0)
    held.resolve({snapshot:{...snapshot,token0:{...token,symbol:'STALE'}}});await flush()
    expect(view.result.current.quote.tokens[0].symbol).toBe('TEST')
    expect(calls('eth_estimateGas')).toHaveLength(0)
  })

  it('cancels a network prompt without a late add-chain, second switch or send',async()=>{
    const held=deferred<unknown>()
    mocks.request.mockImplementation(args=>args.method==='eth_chainId'?Promise.resolve('0x1'):args.method==='wallet_switchEthereumChain'?held.promise:standard(args))
    const view=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    let task!:Promise<void>
    await act(async()=>{task=view.result.current.advance()});await flush()
    expect(calls('wallet_switchEthereumChain')).toHaveLength(1)
    // A human's network prompt is not incorrectly timed out as a silent read.
    await act(async()=>{await vi.advanceTimersByTimeAsync(60_000)})
    expect(view.result.current.busy).toBe(true);expect(view.result.current.closeBlocked).toBe(false)
    view.unmount();await act(async()=>{await task})
    held.reject(Object.assign(new Error('Unknown chain'),{code:4902}));await flush()
    expect(calls('wallet_addEthereumChain')).toHaveLength(0)
    expect(calls('wallet_switchEthereumChain')).toHaveLength(1)
    expect(calls('eth_sendTransaction')).toHaveLength(0);expect(locks.size).toBe(0)
  })

  it('never turns a slow real send into a retry and retains its durable intent on unmount',async()=>{
    const held=deferred<unknown>()
    mocks.request.mockImplementation(args=>args.method==='eth_sendTransaction'?held.promise:standard(args))
    const view=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    let task!:Promise<void>
    await act(async()=>{task=view.result.current.advance()});await flush()
    expect(calls('eth_sendTransaction')).toHaveLength(1)
    expect(view.result.current.closeBlocked).toBe(true)
    const key=positionStorageKey(account,'vault-a')
    expect(JSON.parse(localStorage.getItem(key)!)).toMatchObject({nonce:3,stage:'claim'})
    await act(async()=>{view.result.current.cancelPreflight();await vi.advanceTimersByTimeAsync(5*60_000)})
    expect(view.result.current.busy).toBe(true);expect(locks.size).toBe(1)
    view.unmount()
    expect(localStorage.getItem(key)).not.toBeNull()
    held.reject(new Error('Wallet response lost'))
    await act(async()=>{await task})
    const reopened=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    await act(async()=>{await reopened.result.current.advance()})
    expect(calls('eth_sendTransaction')).toHaveLength(1)
    expect(reopened.result.current.pending?.nonce).toBe(3)
    expect(locks.size).toBe(0)
  })

  it('also bounds standalone wallet-public reads without retrying',async()=>{
    mocks.request.mockImplementation(()=>new Promise(()=>{}))
    const read=walletPublicClient(robinhoodChain).getTransactionCount({address:account})
    const assertion=expect(read).rejects.toThrow(/timed out/)
    await vi.advanceTimersByTimeAsync(WALLET_READ_TIMEOUT_MS+1);await assertion
    expect(calls('eth_getTransactionCount')).toHaveLength(1)
  })

  it.each(['close','timeout'])('keeps viem’s final internal chain read cancellable by %s, without a false recovery record',async(how)=>{
    const held=deferred<unknown>();let chainReads=0
    mocks.request.mockImplementation(args=>args.method==='eth_chainId'&&++chainReads===3?held.promise:standard(args))
    const view=renderHook(()=>useVaultPosition(account,'vault-a','claim'));await flush()
    let task!:Promise<void>
    await act(async()=>{task=view.result.current.advance()});await flush()
    expect(chainReads).toBe(3);expect(view.result.current.closeBlocked).toBe(false)
    if(how==='close')view.unmount()
    else await act(async()=>{await vi.advanceTimersByTimeAsync(WALLET_READ_TIMEOUT_MS+1)})
    await act(async()=>{await task})
    held.resolve('0x1237');await flush()
    expect(locks.size).toBe(0);expect(calls('eth_sendTransaction')).toHaveLength(0)
    expect(localStorage.getItem(positionStorageKey(account,'vault-a'))).toBeNull()
  })
})
