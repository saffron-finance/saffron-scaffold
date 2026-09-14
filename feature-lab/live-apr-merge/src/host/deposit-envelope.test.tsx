import {act,cleanup,renderHook,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {decodeFunctionData,type Address} from 'viem'
import {abi} from '../../shared/vault-lifecycle.mjs'
import {useVaultPosition} from './useVaultPosition'

// Price changes at the contract-read boundary. The controller, finite approvals,
// intent lock and last-moment action revalidation are the production code.
const mocks=vi.hoisted(()=>({read:vi.fn(),context:vi.fn(),amounts:vi.fn(),send:vi.fn(),receipt:vi.fn(),wallet:vi.fn()}))
vi.mock('../../shared/liquidity-math.mjs',async original=>({...await original<any>(),amountsForLiquidity:mocks.amounts}))
vi.mock('../../shared/vault-lifecycle.mjs',async original=>({...await original<any>(),eligibility:()=>({depositable:true,state:'ready'})}))
vi.mock('./transport',()=>({requestJson:mocks.context,readSession:vi.fn(),authedJson:vi.fn(),robinhoodClient:{readContract:mocks.read,getBalance:async()=>10n**20n,waitForTransactionReceipt:mocks.receipt}}))
vi.mock('@lab/wallet/wallet',()=>({walletClient:({onSubmit}:any)=>({sendTransaction:async(args:any)=>{onSubmit();return mocks.send(args)}}),walletPublicClient:()=>({estimateGas:async()=>1n,getTransactionCount:async()=>0,getChainId:async()=>4663}),assertWalletAccount:async()=>{},ensureChain:async()=>{},selectedWalletProviderId:()=> 'fixture'}))
const account=('0x'+'11'.repeat(20)) as Address,vault=('0x'+'22'.repeat(20)) as Address,adapter=('0x'+'33'.repeat(20)) as Address
const tokens=[{address:('0x'+'44'.repeat(20)) as Address,symbol:'A',decimals:0},{address:('0x'+'55'.repeat(20)) as Address,symbol:'B',decimals:0}]
let raw=10000n,allowances=[0n,0n]
beforeEach(()=>{
 localStorage.clear();raw=10000n;allowances=[0n,0n];mocks.send.mockReset().mockResolvedValue('0x'+'aa'.repeat(32));mocks.receipt.mockRejectedValue(Error('Awaiting receipt'))
 mocks.context.mockResolvedValue({deployment:{depositable:true},snapshot:{vault,adapter,token0:tokens[0],token1:tokens[1],headTimestamp:Math.floor(Date.now()/1000)}})
 mocks.amounts.mockImplementation(()=>({amount0:raw,amount1:raw}))
 mocks.read.mockImplementation(async({address,functionName}:any)=>functionName==='allowance'?allowances[tokens.findIndex(t=>t.address===address)]:1000000n)
 Object.defineProperty(navigator,'locks',{configurable:true,value:{request:async(_name:any,_options:any,callback:any)=>callback({name:'fixture'})}})
})
afterEach(cleanup)
const ready=async(view:any)=>waitFor(()=>expect(view.result.current.quote).not.toBeNull())
const approval=(view:any)=>decodeFunctionData({abi,data:view.result.current.quote.action.data}).args?.[1]

it('keeps the approved envelope through both approvals and ordinary price drift',async()=>{
 const view=renderHook(()=>useVaultPosition(account,'one','deposit'));await ready(view)
 expect(approval(view)).toBe(10050n)
 allowances[0]=10050n;raw=10001n
 await act(async()=>view.result.current.refresh())
 expect(view.result.current.quote.action.stage).toBe('approve-1');expect(approval(view)).toBe(10050n)
 allowances[1]=10050n;raw=10020n
 await act(async()=>view.result.current.refresh())
 expect(view.result.current.quote.action.stage).toBe('deposit')
 expect(view.result.current.quote.maximums).toEqual([10050n,10050n])
 raw=10040n;await act(async()=>view.result.current.advance())
 expect(mocks.send).toHaveBeenCalledOnce()
})

it('reopening accepts allowances covering actual spend without refilling the buffer',async()=>{
 allowances=[10030n,10030n]
 const view=renderHook(()=>useVaultPosition(account,'one','deposit'));await ready(view)
 expect(view.result.current.quote.action.stage).toBe('deposit')
 expect(view.result.current.quote.maximums).toEqual([10030n,10030n])
})

it('real spend beyond the envelope requires review and a finite reset/approval, never an automatic send',async()=>{
 allowances=[10050n,10050n]
 const view=renderHook(()=>useVaultPosition(account,'one','deposit'));await ready(view)
 raw=10051n;await act(async()=>view.result.current.advance())
 expect(mocks.send).not.toHaveBeenCalled();expect(view.result.current.error).toMatch(/Review the updated modal/)
 expect(view.result.current.quote.action.stage).toBe('approve-0');expect(approval(view)).toBe(0n)
 allowances[0]=0n;await act(async()=>view.result.current.refresh())
 expect(approval(view)).toBe(10102n)
})

it('does not reuse a previous vault envelope for another vault',async()=>{
 const view=renderHook(({id})=>useVaultPosition(account,id,'deposit'),{initialProps:{id:'one'}});await ready(view)
 raw=10001n;view.rerender({id:'two'});await ready(view)
 await waitFor(()=>expect(view.result.current.quote.maximums).toEqual([10052n,10052n]))
})
