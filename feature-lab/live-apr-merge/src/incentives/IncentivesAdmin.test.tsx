import {cleanup,render,screen,waitFor} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {IncentivesAdmin} from './IncentivesAdmin'

// Mount the real administration component and its independent polling hooks.
// Only HTTP responses and decorative configuration UI are replaced.
const mocks=vi.hoisted(()=>({read:vi.fn(),session:vi.fn()}))
vi.mock('../host/transport',()=>({requestJson:mocks.read,readSession:mocks.session,authedJson:vi.fn(),ensureOperatorSession:vi.fn()}))
vi.mock('./ConfigurationWarnings',()=>({ConfigurationWarnings:()=>null}))
const account='0x1111111111111111111111111111111111111111'
const row={id:'healthy-vault',wallet:account,state:'depositable',workerState:'created',fundingState:'funded',
  snapshot:{display:{pair:'TEST / USDG'},durationSeconds:86400,fixedCapacityAmount:'10000'},
  plan:{premium:'100',variableDecimals:2,variableSymbol:'TEST'},transactions:[]}
const show=(wallet:typeof account|null=account)=>render(<ThemeProvider theme={darkTheme}><IncentivesAdmin account={wallet} onConnect={()=>{}} onBack={()=>{}} onNavigate={()=>{}}/></ThemeProvider>)
beforeEach(()=>{mocks.read.mockReset();mocks.session.mockReset();mocks.session.mockImplementation(()=>new Promise(()=>{}))})
afterEach(cleanup)

it.each(['stalled session','stalled health','failed health'])('renders authorized vault rows despite %s',async failure=>{
 if(failure!=='stalled session')mocks.session.mockResolvedValue({operator:true})
 mocks.read.mockImplementation((path:string)=>path.startsWith('/admin/deployments')?Promise.resolve({deployments:[row]}):failure==='failed health'?Promise.reject(Error('Health unavailable')):new Promise(()=>{}))
 show()
 await waitFor(()=>expect(document.querySelector('[data-deployment-id="healthy-vault"]')).toBeInTheDocument())
 expect(screen.getByLabelText('Deployment queue')).toBeVisible()
 expect(screen.queryByRole('button',{name:'Sign in as operator'})).not.toBeInTheDocument()
})

it('accepts an authorized empty list without session discovery, but not an unauthorized response',async()=>{
 mocks.read.mockResolvedValue({deployments:[]});const view=show()
 await screen.findByText('No deployment requests on this page.');view.unmount()
 mocks.read.mockRejectedValue(Error('Operator authentication required.'));show()
 await screen.findByText('Operator authentication required.')
 expect(screen.queryByLabelText('Deployment queue')).not.toBeInTheDocument()
 expect(screen.getByRole('button',{name:'Sign in as operator'})).toBeVisible()
})
