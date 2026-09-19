import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {DeploymentWaiting} from './DeploymentWaiting'
import source from './DeploymentWaiting.tsx?raw'
import labels from './model.ts?raw'

// Written before removing compatibility branches. Exercise the real presenter
// with authoritative API states; no wallet, transactions or backend is loaded.
const status=vi.hoisted(()=>({data:null as any,error:'',refresh:vi.fn()}))
vi.mock('../host/useDeploymentStatus',()=>({useDeploymentStatus:()=>status}))
vi.mock('./VaultLifecyclePanel',()=>({VaultLifecyclePanel:()=>null}))
beforeEach(()=>{
 status.error='';status.data={id:'request',transactions:[],progress:{reason:'creating',activeStage:1},depositable:false}
})
afterEach(cleanup)
function show(){return render(<ThemeProvider theme={darkTheme}><DeploymentWaiting account='0x1111111111111111111111111111111111111111' id='request' position={false} onPosition={()=>{}} onBusy={()=>{}}/></ThemeProvider>)}

it.each([
 ['queued',null,'Your request is queued',true],
 ['creating',1,'Preparing your vault',true],
 ['creating',2,'Creating your vault',true],
 ['creating',3,'Checking your vault',true],
 ['awaiting_funding',4,'Verifying vault',true],
 ['operator_review',1,'Waiting for operator review',true],
 ['verification_unavailable',2,'Verification temporarily unavailable',false],
 ['ready',null,'Your vault is ready',false],
])('preserves current API state %s / stage %s', (reason,activeStage,label,spinning)=>{
 status.data.progress={reason,activeStage};show()
 expect(screen.getByRole('status')).toHaveTextContent(String(label))
 expect(document.querySelector('[data-request-spinner]')).toHaveAttribute('data-spinning',String(spinning))
})
it.each([
 ['refund_pending','Creation fee refund pending'],
 ['refunded','Creation fee refunded'],
 ['refund_exception','Refund verification needs review'],
])('keeps %s visible while creation remains stopped', (state,label)=>{
 status.data.progress={reason:'operator_review',activeStage:1}
 status.data.refund={state,amountWei:'4000000000000001',verifiedWei:'2000000000000000'}
 show();expect(screen.getByRole('status')).toHaveTextContent(label)
 expect(screen.getByText(/0.002 \/ 0.004000000000000001 ETH verified/)).toBeVisible()
 expect(document.querySelector('[data-request-spinner]')).toHaveAttribute('data-spinning','false')
 expect(screen.queryByRole('button',{name:'Deposit LP assets'})).toBeNull()
})
it('does not include retired, old payment or wallet-free sample screens in the production presenter',()=>{
 // A source-level exclusion is intentional: fixtures must not perpetuate screens
 // that have no producer in the current backend contract.
 expect(source).not.toMatch(/retired|retirement_requested|startsWith\('payment_'\)|paymentState==='sample'|activeStage===4/)
 expect(labels).not.toMatch(/retired:|retirement_requested:/)
})
