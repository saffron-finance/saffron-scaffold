import {beforeEach,expect,it,vi} from 'vitest'
import {depositVariable} from './deposit'
const f=vi.hoisted(()=>({readContract:vi.fn(),writeContract:vi.fn(),waitForTransactionReceipt:vi.fn(),ensureChain:vi.fn()}))
vi.mock('./wallet',()=>({walletClient:()=>f,walletPublicClient:()=>f,ensureChain:f.ensureChain}))
beforeEach(()=>{vi.clearAllMocks();f.readContract.mockImplementation(({functionName})=>Promise.resolve(functionName==='balanceOf'?100n:0n));f.writeContract.mockResolvedValue('0xabc')})
const vault={chainKey:'ethereum',variableAssetDecimals:0,variableAsset:'0x1',vault:'0x2'} as any
it('L01 a reverted approval never proceeds to a deposit send',async()=>{
  f.waitForTransactionReceipt.mockResolvedValue({status:'reverted'})
  const steps=vi.fn();await expect(depositVariable(vault,'1','0x123',steps)).rejects.toThrow('approval reverted')
  expect(f.writeContract).toHaveBeenCalledTimes(1);expect(steps).not.toHaveBeenCalledWith('done')
})
it('L01 a reverted deposit is not reported as done',async()=>{
  f.waitForTransactionReceipt.mockResolvedValueOnce({status:'success'}).mockResolvedValueOnce({status:'reverted'})
  const steps=vi.fn();await expect(depositVariable(vault,'1','0x123',steps)).rejects.toThrow('Deposit reverted')
  expect(f.writeContract).toHaveBeenCalledTimes(2);expect(steps).not.toHaveBeenCalledWith('done')
})
it('L01 successful receipts retain the normal completion path',async()=>{
  f.waitForTransactionReceipt.mockResolvedValue({status:'success'})
  const steps=vi.fn();expect(await depositVariable(vault,'1','0x123',steps)).toEqual({hash:'0xabc'})
  expect(steps).toHaveBeenLastCalledWith('done')
})
