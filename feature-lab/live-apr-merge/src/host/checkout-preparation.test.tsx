import {act,cleanup,renderHook} from '@testing-library/react'
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest'
import type {Address} from 'viem'

// Use the real selected-provider adapter and viem transport. Only the read-only
// backend and contract snapshot are fixtures; no keys, RPC or real wallet sends.
const mocks=vi.hoisted(()=>({context:vi.fn(),receipt:vi.fn(),request:vi.fn(),transaction:vi.fn(),block:vi.fn(),nonce:vi.fn(async()=>3)}))
vi.mock('@lab/wallet/walletconnect',()=>({WALLETCONNECT_ID:'wallet:walletconnect',WALLETCONNECT_RDNS:'org.walletconnect',walletConnectConfigured:false}))
vi.mock('./transport',()=>({
  requestJson:mocks.context,rememberPayment:vi.fn(),authedJson:vi.fn(),readSession:vi.fn(async()=>({operator:true})),
  robinhoodClient:{waitForTransactionReceipt:mocks.receipt,getTransaction:mocks.transaction,getBlock:mocks.block,getTransactionCount:mocks.nonce},
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


import {useDeploymentFlow} from './useDeploymentFlow'
import {paymentRecordsKey,readPayments,savePayment} from './payment-records.mjs'

afterEach(async()=>{cleanup();await disconnect();vi.useRealTimers()})

it.each(['Back','unmount','dismiss'])('N027: %s revokes pending network switching and releases quote preparation',async action=>{
  const held=deferred<unknown>()
  mocks.request.mockImplementation(args=>args.method==='eth_chainId'?Promise.resolve('0x1'):args.method==='wallet_switchEthereumChain'?held.promise:standard(args))
  const view=renderHook(()=>useDeploymentFlow(account));await flush()
  let work!:Promise<any>;await act(async()=>{work=view.result.current.review({id:'campaign'} as any,'100')});await flush()
  expect(calls('wallet_switchEthereumChain')).toHaveLength(1);expect(locks.size).toBe(1)
  await act(async()=>{await vi.advanceTimersByTimeAsync(60_000)})
  if(action==='Back')await act(async()=>{expect(await view.result.current.reset(true)).toBe(true)})
  else if(action==='dismiss')act(()=>view.result.current.cancelPreparation())
  else view.unmount()
  await act(async()=>{await work})
  expect(locks.size).toBe(0);expect(mocks.context).not.toHaveBeenCalled()
  held.reject(Object.assign(Error('Unknown chain'),{code:4902}));await flush()
  expect(calls('wallet_addEthereumChain')).toHaveLength(0);expect(calls('eth_sendTransaction')).toHaveLength(0)
  expect(readPayments(localStorage,account).draft).toBeNull()
})

it('N005: an internal pre-send chain timeout leaves no submitted payment or reserved nonce',async()=>{
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const quote={id,wallet:account,fee:{recipient:'0x'+'22'.repeat(20),amountWei:'1'},paymentDeadline:new Date(Date.now()+300000).toISOString(),planHash:'fixture',recoveryHash:'fixture'}
  savePayment(localStorage,account,readPayments(localStorage,account),{quote,recoverySecret:'fixture',sent:false,status:'prepared'} as any)
  const held=deferred<unknown>();let chains=0
  mocks.request.mockImplementation(args=>args.method==='eth_chainId'&&++chains===2?held.promise:standard(args))
  const view=renderHook(()=>useDeploymentFlow(account));await flush()
  let work!:Promise<boolean>;await act(async()=>{work=view.result.current.pay()});await flush()
  expect(chains).toBe(2);expect(calls('eth_sendTransaction')).toHaveLength(0)
  await act(async()=>{await vi.advanceTimersByTimeAsync(WALLET_READ_TIMEOUT_MS+1);await work})
  expect(locks.size).toBe(0)
  expect(readPayments(localStorage,account).records[id]).toMatchObject({sent:false,status:'prepared'})
  expect(readPayments(localStorage,account).records[id].nonce).toBeUndefined()
  await act(async()=>{expect(await view.result.current.reset()).toBe(true)})
  held.resolve('0x1237');await flush();expect(calls('eth_sendTransaction')).toHaveLength(0)
})
