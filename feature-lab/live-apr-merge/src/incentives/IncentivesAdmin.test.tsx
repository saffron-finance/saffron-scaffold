import {MyVaults} from './MyVaults'
import {programReference} from './program-language'
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {IncentivesAdmin} from './IncentivesAdmin'

// Mount the real administration component and its independent polling hooks.
// Only HTTP responses and decorative configuration UI are replaced.
const mocks=vi.hoisted(()=>({read:vi.fn(),session:vi.fn(),authed:vi.fn()}))
vi.mock('../host/transport',()=>({requestJson:mocks.read,readSession:mocks.session,authedJson:mocks.authed,ensureOperatorSession:vi.fn()}))
vi.mock('./ConfigurationWarnings',()=>({ConfigurationWarnings:()=>null}))
const account='0x1111111111111111111111111111111111111111'
const row={id:'healthy-vault',wallet:account,state:'depositable',workerState:'created',fundingState:'funded',
  snapshot:{display:{pair:'TEST / USDG'},durationSeconds:86400,fixedCapacityAmount:'10000'},
  plan:{premium:'100',variableDecimals:2,variableSymbol:'TEST'},transactions:[]}
const show=(wallet:typeof account|null=account)=>render(<ThemeProvider theme={darkTheme}><IncentivesAdmin account={wallet} onConnect={()=>{}} onBack={()=>{}} onNavigate={()=>{}}/></ThemeProvider>)
beforeEach(()=>{history.replaceState(null,'','/admin');mocks.read.mockReset();mocks.authed.mockReset();mocks.session.mockReset();mocks.session.mockImplementation(()=>new Promise(()=>{}))})
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

it('matches full incentive program IDs across queue and per-program configuration rows regardless of catalog ordering',async()=>{
 // Two campaigns share a pair. Their identities must not depend on the pair,
 // display order, budget key or request ID; all four can differ independently.
 const ids=['campaign-11111111-1111-4111-8111-111111111111','campaign-22222222-2222-4222-8222-222222222222']
 const pair={id:'pair-shared',token0:{symbol:'TEST'},token1:{symbol:'USDG'},feeTier:3000}
 const programs=ids.map((id,i)=>({id,revision:1,pairId:pair.id,budgetPoolId:'budget-'+i,days:3,requestFeeWei:'1'}))
 const budgets=programs.map(program=>({id:program.budgetPoolId,decimals:2,limitRaw:'100',reservedRaw:'0',allocatedRaw:'0'})).reverse()
 const catalog={pairs:[pair],programs,budgets}
 const deployments=programs.map((program,i)=>({...row,id:'request-'+i,programId:program.id}))
 // A historical request still identifies its campaign after catalog removal.
 deployments.push({...row,id:'archived-request',programId:'campaign-removed'})
 mocks.read.mockImplementation((path:string)=>path.startsWith('/admin/deployments')?Promise.resolve({deployments}):new Promise(()=>{}))
 mocks.authed.mockResolvedValue(catalog)
 show()
 const queue=await screen.findByLabelText('Deployment queue')
 for(const request of deployments){
   const details=queue.querySelector('[data-deployment-id="'+request.id+'"]')!.parentElement!
   expect(within(details.querySelector('summary')!).getByText(programReference(request.programId))).toBeVisible()
 }
 fireEvent.click(screen.getByRole('button',{name:'Incentive programs',exact:true}))
 fireEvent.click(screen.getByRole('button',{name:'Load incentive catalog'}))
 await screen.findByRole('button',{name:'Reload incentive programs'})
 for(const program of programs){
   const card=document.querySelector('[data-budget-id="'+program.budgetPoolId+'"]')!
   expect(within(card as HTMLElement).getByText(programReference(program.id))).toBeVisible()
   expect(within(card as HTMLElement).getByRole('button',{name:'Open incentive program '+programReference(program.id)})).toBeVisible()
 }
 mocks.authed.mockResolvedValue({...catalog,programs:[...programs].reverse().map(program=>({...program,revision:2})),budgets:[...budgets].reverse()})
 fireEvent.click(screen.getByRole('button',{name:'Reload incentive programs'}))
 await waitFor(()=>expect(mocks.authed).toHaveBeenCalledTimes(2))
 for(const program of programs)expect(document.querySelector('[data-budget-id="'+program.budgetPoolId+'"] [data-program-reference]')).toHaveAttribute('data-program-reference',program.id)
 // Viewing identifiers must never save campaign settings or sign a transaction.
 expect(mocks.authed.mock.calls.every(args=>args[1]==='/admin/catalog'&&args.length===2)).toBe(true)
})

it('does not invent an incentive program identity when a legacy request has none',async()=>{
 mocks.read.mockImplementation((path:string)=>path.startsWith('/admin/deployments')?Promise.resolve({deployments:[row]}):new Promise(()=>{}))
 show()
 const queue=await screen.findByLabelText('Deployment queue')
 expect(within(queue).getByText('Unavailable',{exact:true})).toBeVisible()
 expect(queue.querySelector('[data-program-reference]')).toBeNull()
})

it('M04: reload refreshes pristine planning values and refuses dirty revision conflicts',async()=>{
  const make=(revision:number,cents:string)=>({pairs:[],programs:[],budgets:[{id:'budget',name:'Plan',revision,decimals:2,limitRaw:'0',reservedRaw:'0',allocatedRaw:'0',advisoryBudgetCents:cents,campaign:{budgetCents:'1000000'}}]})
  mocks.read.mockResolvedValue({deployments:[]});mocks.authed.mockResolvedValue(make(1,'1000000'))
  show();await screen.findByText('No deployment requests on this page.')
  fireEvent.click(screen.getByRole('button',{name:'Incentive programs',exact:true}));fireEvent.click(screen.getByRole('button',{name:'Load incentive catalog'}))
  const input=await screen.findByLabelText('Planning budget for Plan')
  fireEvent.click(screen.getByText('Funding & accounting'))
  expect(input).toHaveValue('10000')
  mocks.authed.mockResolvedValue(make(2,'2000000'))
  fireEvent.click(screen.getByRole('button',{name:'Reload incentive programs'}))
  await waitFor(()=>expect(input).toHaveValue('20000'))
  fireEvent.click(screen.getByRole('button',{name:'Update planning target'}))
  await waitFor(()=>expect(mocks.authed).toHaveBeenCalledWith(account,'/admin/budgets/budget/advisory',{revision:2,budgetUsd:'20000'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Update planning target'})).toBeEnabled())
  fireEvent.change(input,{target:{value:'30000'}})
  mocks.authed.mockResolvedValue(make(3,'4000000'))
  fireEvent.click(screen.getByRole('button',{name:'Reload incentive programs'}))
  await waitFor(()=>expect(screen.getByRole('button',{name:'Use latest target'})).toBeVisible())
  expect(input).toHaveValue('30000');expect(screen.getByRole('button',{name:'Update planning target'})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'Use latest target'}))
  expect(input).toHaveValue('40000')
})

it('translates historical worker prose without modifying the request record',async()=>{
 const historical={...row,error:'Campaign execution is paused.',nextAttemptAt:'2026-09-19T00:00:00Z'}
 mocks.read.mockImplementation((path:string)=>path.startsWith('/admin/deployments')?Promise.resolve({deployments:[historical]}):new Promise(()=>{}))
 show();await screen.findByLabelText('Deployment queue')
 fireEvent.click(document.querySelector('[data-deployment-id="healthy-vault"]')!.parentElement!.querySelector('summary')!)
 expect(await screen.findByText(/Incentive program execution is paused/)).toBeVisible()
 expect(document.body.textContent).not.toMatch(/campaign/i)
 expect(historical.error).toBe('Campaign execution is paused.')
})

it('translates legacy planning names only in the operator portfolio display',async()=>{
 const planning={id:'campaign-historical',name:'Historical campaign',nearCapacity:true,overTarget:false}
 mocks.read.mockResolvedValue({campaigns:[planning]})
 const positions={rows:[],payments:[],session:{operator:true},page:1,paymentPage:1,refresh:vi.fn()}
 render(<ThemeProvider theme={darkTheme}><MyVaults account={account} positions={positions as any} onConnect={()=>{}} onOpen={()=>{}} onBack={()=>{}} onAdmin={()=>{}} payments={[]} onResumePayment={()=>{}}/></ThemeProvider>)
 expect(await screen.findByText(/Historical incentive program: near capacity/)).toBeVisible()
 expect(document.body.textContent).not.toMatch(/campaign/i)
 expect(planning.name).toBe('Historical campaign')
})
