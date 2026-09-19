import {act,cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {DeployerBalance,ProgramDeployerBalance} from './DeployerBalance'
import type {AdminHealth} from '../host/useAdminHealth'

const mocks=vi.hoisted(()=>({health:vi.fn()}))
vi.mock('../host/useAdminHealth',()=>({useAdminHealth:mocks.health}))
vi.mock('./styles',()=>({QuietButton:(props:any)=><button {...props}/>}))
const wallet='0x'+'12'.repeat(20)
const report=(amount='15000000000000000')=>({checks:[{id:'server-gas',walletBalance:{address:wallet,chainId:4663,amountWei:amount,minimumWei:'15000000000000000',observedAt:new Date().toISOString()}}]} as AdminHealth)
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date('2026-09-13T12:00:00Z'))})
afterEach(()=>{cleanup();vi.useRealTimers();vi.clearAllMocks()})

it('shows exact threshold, real zero and tiny nonzero balances without inventing a zero on failure',()=>{
 const refresh=vi.fn(),view=render(<DeployerBalance report={report()} onRefresh={refresh}/>)
 expect(screen.getByText('0.015 ETH')).toHaveAttribute('title','0.015 ETH');expect(screen.getByText('Gas reserve met')).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Refresh balance'}));expect(refresh).toHaveBeenCalledOnce()
 view.rerender(<DeployerBalance report={report('0')} onRefresh={refresh}/>)
 expect(screen.getByText('0 ETH')).toBeVisible();expect(screen.getByText('Below startup minimum')).toBeVisible()
 view.rerender(<DeployerBalance report={report('1')} onRefresh={refresh}/>)
 expect(screen.getByText('<0.00000001 ETH')).toHaveAttribute('title','0.000000000000000001 ETH')
 view.rerender(<DeployerBalance report={null} onRefresh={refresh}/>)
 expect(screen.getByText('Unavailable')).toBeVisible();expect(screen.queryByText('0 ETH')).not.toBeInTheDocument()
})

it('expires a stalled observation locally, without requesting any new data',async()=>{
 const refresh=vi.fn();render(<DeployerBalance report={report()} onRefresh={refresh}/>)
 await act(async()=>vi.advanceTimersByTimeAsync(25001))
 expect(screen.getByText('Unavailable')).toBeVisible();expect(screen.queryByText('Gas reserve met')).not.toBeInTheDocument();expect(refresh).not.toHaveBeenCalled()
})

it('rejects wrong-chain, missing, future and invalid amounts while retaining the public address',()=>{
 for(const patch of [{chainId:1},{amountWei:null},{amountWei:'invalid'},{observedAt:new Date(Date.now()+10000).toISOString()}]){
  const r=report();Object.assign((r.checks[0] as any).walletBalance,patch)
  const view=render(<DeployerBalance report={r} onRefresh={()=>{}}/>)
  expect(screen.getByText('Unavailable')).toBeVisible();expect(screen.getByRole('link')).toHaveTextContent(wallet);view.unmount()
 }
})

it('keeps standalone incentive program balances behind operator sign-in',()=>{
 mocks.health.mockReturnValue({session:null,report:report(),refresh:vi.fn()})
 const view=render(<ProgramDeployerBalance account={wallet as `0x${string}`}/>)
 expect(screen.queryByLabelText('Deployer wallet balance')).not.toBeInTheDocument()
 mocks.health.mockReturnValue({session:{operator:true},report:report(),refresh:vi.fn()})
 view.rerender(<ProgramDeployerBalance account={wallet as `0x${string}`}/>)
 expect(screen.getByLabelText('Deployer wallet balance')).toBeVisible()
})
