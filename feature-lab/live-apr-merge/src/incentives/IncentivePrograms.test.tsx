import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {ProgramAdmin} from './ProgramAdmin'
import {CreateIncentiveProgramPage} from './CreateIncentiveProgramPage'

// Written before the refactor: these assert the new visible contract while
// deliberately retaining legacy IDs and payload keys at the HTTP boundary.
const api=vi.hoisted(()=>({authed:vi.fn()}))
vi.mock('../host/transport',()=>({authedJson:api.authed}))
vi.mock('./ConfigurationWarnings',()=>({ConfigurationWarnings:()=>null}))
vi.mock('./DeployerBalance',()=>({ProgramDeployerBalance:()=>null}))
const account='0x1111111111111111111111111111111111111111'
const pair={id:'pair',revision:1,chainId:4663,pool:account,feeTier:3000,active:true,token0:{address:account,symbol:'TEST',decimals:18},token1:{address:account,symbol:'USDG',decimals:18}}
const program={id:'campaign-one',revision:4,pairId:'pair',budgetPoolId:'campaign-budget',apr:500,days:7,requestFeeWei:'4000000000000001',minimumCents:'1',maximumCents:'10000000',sortOrder:0,isNew:false,active:true}
const budget={id:'campaign-budget',name:'Campaign planning',revision:8,chainId:4663,rewardAsset:account,decimals:18,limitRaw:'0',reservedRaw:'0',allocatedRaw:'0',availableRaw:'0',paused:false,reconciliationRequired:false,advisoryBudgetCents:'123456',campaign:{days:7,budgetCents:'1000000',capacityCents:'100000000',aprPercent:'500'}}
let catalog:any
const navigate=vi.fn()
const show=(create=false)=>render(<ThemeProvider theme={darkTheme}>{create?<CreateIncentiveProgramPage account={account} onConnect={()=>{}} onBack={navigate}/>:<ProgramAdmin autoLoad account={account} onConnect={()=>{}} onCreate={navigate}/>}</ThemeProvider>)
const open=async(id='one')=>fireEvent.click(await screen.findByRole('button',{name:'Open incentive program program-'+id}))
function visibleLanguage(){
  const text=document.body.textContent??''
  const labels=[...document.querySelectorAll('[aria-label],[title],[placeholder]')].map(node=>['aria-label','title','placeholder'].map(a=>node.getAttribute(a)||'').join(' ')).join(' ')
  expect(text+' '+labels).not.toMatch(/campaign/i)
}
beforeEach(()=>{
 history.replaceState(null,'','/incentive-programs');api.authed.mockReset();navigate.mockReset()
 catalog={pairs:[pair],programs:[program,{...program,id:'campaign-two',days:3,active:false}],budgets:[budget]}
 api.authed.mockImplementation(async(_wallet,path)=>path==='/admin/catalog'?structuredClone(catalog):{ok:true})
})
afterEach(cleanup)

it('uses searchable program cards, includes disabled programs, and contains no old visible terminology',async()=>{
 show();const directory=await screen.findByRole('list',{name:'Incentive programs'})
 expect(within(directory).getAllByRole('listitem')).toHaveLength(2)
 expect(within(directory).getByText('Disabled')).toBeVisible()
 expect(screen.queryByRole('form',{name:'Create incentive program'})).toBeNull()
 expect(screen.queryByRole('table',{name:/configuration/i})).toBeNull()
 visibleLanguage()
 const search=screen.getByRole('searchbox',{name:'Find a program'})
 fireEvent.change(search,{target:{value:'program-two'}})
 expect(within(directory).getAllByRole('listitem')).toHaveLength(1)
 fireEvent.change(search,{target:{value:'7'}})
 expect(within(directory).getByText('program-one')).toBeVisible()
 fireEvent.change(search,{target:{value:'no matching pair'}})
 expect(screen.getByText('No incentive programs match this search.')).toBeVisible()
 expect(api.authed.mock.calls.every(args=>args[1]==='/admin/catalog'&&args.length===2)).toBe(true)
})

it('opens only the selected program and saves exact fees using its unchanged canonical identity',async()=>{
 show();await open()
 const detail=screen.getByRole('region',{name:'Incentive program details'})
 expect(within(detail).getByText('program-one')).toBeVisible()
 expect(within(detail).queryByText('program-two')).toBeNull()
 const input=within(detail).getByLabelText('Request fee ETH for program-one')
 expect(input).toHaveValue('0.004000000000000001')
 fireEvent.change(input,{target:{value:'0.123456789012345678'}})
 fireEvent.click(within(detail).getByRole('button',{name:'Save request fee'}))
 await waitFor(()=>expect(api.authed).toHaveBeenCalledWith(account,'/admin/programs',{...program,requestFeeWei:'123456789012345678'}))
 visibleLanguage()
})

it('preserves shared-budget pause semantics without writing a displayed alias to the API',async()=>{
 show();await open()
 expect(screen.getByText('Pause / resume affects all programs sharing this budget.')).toBeVisible()
 fireEvent.click(screen.getByRole('button',{name:'Pause incentive program'}))
 await waitFor(()=>expect(api.authed).toHaveBeenCalledWith(account,'/admin/budgets',{...budget,paused:true}))
 expect(api.authed.mock.calls.filter(args=>args.length===3)).toHaveLength(1)
})

it('isolates unsaved inputs when a history link selects a different program',async()=>{
 // Two independent records can share the same revision. Navigation must not
 // reuse an old program's dirty fee or planning draft for the new identity.
 catalog.programs[1]={...catalog.programs[1],budgetPoolId:'other-budget',requestFeeWei:'2000000000000000'}
 catalog.budgets.push({...budget,id:'other-budget',advisoryBudgetCents:'98765'})
 show();await open()
 fireEvent.change(screen.getByLabelText('Request fee ETH for program-one'),{target:{value:'0.9'}})
 fireEvent.change(screen.getByLabelText('Planning budget for program-one'),{target:{value:'888'}})
 history.replaceState(null,'','/incentive-programs#program/program-two')
 fireEvent(window,new HashChangeEvent('hashchange'))
 expect(await screen.findByLabelText('Request fee ETH for program-two')).toHaveValue('0.002')
 expect(screen.getByLabelText('Planning budget for program-two')).toHaveValue('987.65')
 expect(screen.getByRole('button',{name:'Save request fee'})).toBeDisabled()
 expect(api.authed.mock.calls.every(args=>args.length===2)).toBe(true)
})

it('preserves dirty revisions, fails closed after a reload error, and never edits a different program after removal',async()=>{
 show();await open()
 const input=screen.getByLabelText('Request fee ETH for program-one')
 fireEvent.change(input,{target:{value:'0.03'}})
 catalog.programs[0]={...program,revision:5}
 fireEvent.click(screen.getByRole('button',{name:'Reload incentive programs'}))
 await screen.findByRole('button',{name:'Use latest fee'})
 expect(input).toHaveValue('0.03');expect(screen.getByRole('button',{name:'Save request fee'})).toBeDisabled()
 api.authed.mockRejectedValueOnce(Error('Campaign catalog unavailable.'))
 fireEvent.click(screen.getByRole('button',{name:'Reload incentive programs'}))
 await screen.findByText(/Incentive program catalog unavailable/)
 expect(input).toBeDisabled();visibleLanguage()
 catalog.programs=catalog.programs.slice(1)
 fireEvent.click(screen.getByRole('button',{name:'Reload incentive programs'}))
 await screen.findByText('This incentive program is no longer in the current catalog.')
 expect(screen.queryByRole('button',{name:'Save request fee'})).toBeNull()
 expect(api.authed.mock.calls.every(args=>args.length===2)).toBe(true)
})

it('keeps creation separate and retries the exact same creation key and legacy payload',async()=>{
 show(true);await screen.findByRole('form',{name:'Create incentive program'})
 visibleLanguage()
 fireEvent.change(screen.getByLabelText('Incentive program request fee ETH'),{target:{value:'0.000000000000000001'}})
 api.authed.mockRejectedValueOnce(Error('Campaign creation failed; retry.'))
 fireEvent.click(screen.getByRole('button',{name:'Create incentive program'}))
 await screen.findByText('Incentive program creation failed; retry.')
 const before=api.authed.mock.calls.find(args=>args[1]==='/admin/campaigns')![2]
 expect(before).toMatchObject({pairId:'pair',requestFeeWei:'1',active:false,days:3})
 expect(before).not.toHaveProperty('aprPercent')
 fireEvent.click(screen.getByRole('button',{name:'Create incentive program'}))
 await waitFor(()=>expect(navigate).toHaveBeenCalledOnce())
 expect(api.authed.mock.calls.filter(args=>args[1]==='/admin/campaigns')[1][2]).toEqual(before)
})
