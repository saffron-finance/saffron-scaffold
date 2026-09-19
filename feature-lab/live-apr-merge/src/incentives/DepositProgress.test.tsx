import {cleanup,render,screen} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {DeploymentWaiting,RequestPending} from './DeploymentWaiting'

// Design regressions written before the consolidation. The status source owns
// progression; a timer must never pretend that creation has advanced.
const status=vi.hoisted(()=>({data:null as any,error:'',refresh:vi.fn()}))
vi.mock('../host/useDeploymentStatus',()=>({useDeploymentStatus:()=>status}))
vi.mock('./VaultLifecyclePanel',()=>({VaultLifecyclePanel:()=>null}))
const account='0x1111111111111111111111111111111111111111'
const view=()=> <ThemeProvider theme={darkTheme}><DeploymentWaiting account={account} id='saved-request' position={false} onPosition={()=>{}} onBusy={()=>{}}/></ThemeProvider>
beforeEach(()=>{status.error='';status.data={id:'saved-request',transactions:[],createdAt:new Date().toISOString(),progress:{reason:'creating',activeStage:1,stages:[1,2,3,4].map(id=>({id,name:'Stage '+id,state:'active'}))}}})
afterEach(()=>{cleanup();vi.useRealTimers()})
it.each(['Making request...','Confirming payment...'])('shares the existing purple spinner for %s',label=>{
 render(<ThemeProvider theme={darkTheme}><RequestPending label={label}/></ThemeProvider>)
 expect(screen.getByRole('status')).toHaveTextContent(label);expect(document.querySelectorAll('[data-request-spinner]')).toHaveLength(1)
})
it('shows only the current creation phrase under the same spinner, through all four stages',()=>{
 const shown=render(view())
 for(const [index,label]of ['Preparing your vault','Creating your vault','Checking your vault','Verifying vault'].entries()){
  status.data={...status.data,progress:{...status.data.progress,activeStage:index+1}};shown.rerender(view())
  expect(screen.getByRole('status')).toHaveTextContent(label);expect(document.querySelectorAll('[data-request-spinner]')).toHaveLength(1)
  expect(document.querySelector('[data-request-spinner]')?.nextElementSibling).toBe(screen.getByRole('status'))
  expect(screen.queryByRole('list',{name:'Vault creation progress'})).toBeNull()
  expect(document.querySelectorAll('[aria-current="step"]')).toHaveLength(0)
 }
})
it('does not advance a pending status merely because time passes',()=>{
 vi.useFakeTimers();render(view());vi.advanceTimersByTime(30000)
 expect(screen.getByRole('status')).toHaveTextContent('Preparing your vault');expect(document.querySelector('[data-request-spinner]')).toHaveAttribute('data-spinning','true')
})
it.each(['ready','verification_unavailable','retired'])('stops the spinner for %s without hiding its status',reason=>{
 status.data.progress.reason=reason;render(view());expect(document.querySelector('[data-request-spinner]')).toHaveAttribute('data-spinning','false');expect(screen.getByRole('status')).not.toBeEmptyDOMElement()
})
