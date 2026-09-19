import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {DeploymentWaiting} from './DeploymentWaiting'

// Pre-refactor contracts: only the status read and wallet-action child are
// mocked. Rendering this suite never touches a backend, signer, or test chain.
const status=vi.hoisted(()=>({data:null as any,error:'',refresh:vi.fn(),position:vi.fn()}))
vi.mock('../host/useDeploymentStatus',()=>({useDeploymentStatus:()=>status}))
vi.mock('./VaultLifecyclePanel',()=>({VaultLifecyclePanel:(props:any)=>{status.position(props);return <div>Position actions</div>}}))
const account='0x1111111111111111111111111111111111111111',onPosition=vi.fn(),onDeployment=vi.fn(),onBusy=vi.fn()
function show(position=false){return render(<ThemeProvider theme={darkTheme}><DeploymentWaiting account={account} id='saved-request' position={position} onPosition={onPosition} onBusy={onBusy} onDeployment={onDeployment}/></ThemeProvider>)}
beforeEach(()=>{
 vi.clearAllMocks();status.error='';status.data={id:'saved-request',createdAt:new Date().toISOString(),state:'creating',transactions:[],progress:{reason:'creating',activeStage:2,stages:[1,2,3,4].map(id=>({id,name:'Stage '+id,state:id===2?'active':'pending'})),requestedAt:new Date().toISOString(),lastProgressAt:new Date().toISOString(),serviceWindowMinutes:15},depositable:false,canClaim:false,canWithdraw:false,canRecover:false}
})
afterEach(cleanup)
it('uses saved status and keeps manual refresh available before transaction evidence exists',()=>{
 show();expect(screen.getByRole('status')).toHaveTextContent('Creating your vault');expect(onDeployment).toHaveBeenCalledWith(status.data)
 fireEvent.click(screen.getByText('Deployment transactions',{selector:'summary'}));fireEvent.click(screen.getByRole('button',{name:'Check progress'}));expect(status.refresh).toHaveBeenCalledOnce()
 expect(screen.getByText(/return through Portfolio/)).toBeInTheDocument();expect(screen.queryByRole('button',{name:'Deposit LP assets'})).toBeNull()
})
it('retains confirmed transaction links and service-window evidence',()=>{
 const hash='0x'+'a'.repeat(64);status.data.transactions=[{hash,step:'create-vault',confirmed:true}];show()
 fireEvent.click(screen.getByText('Deployment transactions',{selector:'summary'}))
 expect(screen.getByRole('link',{name:/create vault · confirmed/})).toHaveAttribute('href','https://robinhoodchain.blockscout.com/tx/'+hash)
 expect(screen.getByText(/Operator service window: 15 minutes/)).toBeVisible()
})
it('does not enable LP entry while fresh verification is unavailable',()=>{
 status.data.depositable=true;status.data.progress.reason='ready';status.error='Status unavailable';show()
 expect(screen.getByRole('status')).toHaveTextContent('Verification temporarily unavailable')
 const button=screen.getByRole('button',{name:'Deposit LP assets'})
 expect(button).toHaveAttribute('data-incentive-primary-action');expect(button).toBeDisabled();fireEvent.click(button);expect(onPosition).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toHaveTextContent('new actions are paused')
})
it('requires an explicit click before opening ready position actions',()=>{
 status.data.depositable=true;status.data.progress.reason='ready';show()
 const button=screen.getByRole('button',{name:'Deposit LP assets'})
 expect(button).toHaveAttribute('data-incentive-primary-action');expect(status.position).not.toHaveBeenCalled();fireEvent.click(button);expect(onPosition).toHaveBeenCalledOnce()
})
it('preserves exact refund evidence without describing a stopped request as being created',()=>{
 status.data.refund={state:'refunded',amountWei:'4000000000000001',verifiedWei:'4000000000000001'};show()
 expect(screen.getByText(/0.004000000000000001 \/ 0.004000000000000001 ETH verified/)).toBeInTheDocument()
 expect(screen.queryByText(/Your vault is being created now/)).toBeNull()
})
it('delegates existing position and stale-read gates without a second status source',()=>{
 status.error='Unavailable';show(true);expect(status.position).toHaveBeenCalledWith(expect.objectContaining({account,id:'saved-request',row:status.data,verificationError:'Unavailable',onBusy}))
 expect(screen.getByText('Position actions')).toBeVisible()
})
