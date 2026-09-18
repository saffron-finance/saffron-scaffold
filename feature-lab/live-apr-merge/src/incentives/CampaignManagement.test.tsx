import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {ProgramAdmin} from './ProgramAdmin'
import {CreateCampaignPage} from './CreateCampaignPage'
import type {CampaignCatalog} from './campaign-admin'

// These are UI contract tests: only the HTTP boundary is mocked. No chain,
// wallet provider, external requests or production campaign writes are used.
const api=vi.hoisted(()=>({authed:vi.fn()}))
vi.mock('../host/transport',()=>({authedJson:api.authed}))
vi.mock('./ConfigurationWarnings',()=>({ConfigurationWarnings:()=>null}))
vi.mock('./DeployerBalance',()=>({CampaignDeployerBalance:()=>null}))
const account='0x1111111111111111111111111111111111111111'
const token={address:account,symbol:'TEST',decimals:18}
const pair={id:'pair-1',revision:1,chainId:4663,pool:account,feeTier:3000,token0:token,token1:{...token,symbol:'ETH'},active:true}
const program={id:'campaign-full-persisted-id-one',revision:1,pairId:pair.id,budgetPoolId:'budget-1',apr:12.5,days:3,requestFeeWei:'1000000000000001',minimumCents:1,maximumCents:10000,sortOrder:0,isNew:false,active:true}
const budget={id:'budget-1',revision:1,name:'Shared planning',chainId:4663,rewardAsset:account,decimals:18,limitRaw:'100',reservedRaw:'0',allocatedRaw:'0',availableRaw:'100',paused:false,reconciliationRequired:false,advisoryBudgetCents:'1000000',campaign:{days:3,budgetCents:'1000000',capacityCents:'100000000',aprPercent:'121.666666666'}}
let catalog:CampaignCatalog
const navigate=vi.fn()
function show(create=false){return render(<ThemeProvider theme={darkTheme}>{create?<CreateCampaignPage account={account} onConnect={()=>{}} onBack={navigate}/>:<ProgramAdmin autoLoad account={account} onConnect={()=>{}} onCreate={navigate}/>}</ThemeProvider>)}
beforeEach(()=>{navigate.mockReset();api.authed.mockReset();catalog={pairs:[pair],programs:[program],budgets:[budget]};api.authed.mockImplementation(async(_account,path)=>{if(path==='/admin/catalog')return structuredClone(catalog);return {ok:true}})})
afterEach(cleanup)

it('keeps each fee and target in its program row, and creation out of the manager',async()=>{
  catalog.programs.push({...program,id:'campaign-full-persisted-id-two',requestFeeWei:'2'})
  show();await screen.findByRole('table',{name:'Campaign configuration'})
  for(const p of catalog.programs){
    const row=document.querySelector('[data-program-id="'+p.id+'"]') as HTMLElement
    expect(within(row).getByText(p.id)).toBeVisible()
    expect(within(row).getByLabelText('Request fee ETH for '+p.id)).toBeVisible()
    expect(within(row).getByLabelText('Planning budget for '+p.id)).toBeVisible()
    expect(within(row).getByText('Pause / resume affects all programs sharing this budget.')).toBeVisible()
  }
  expect(screen.queryByRole('form',{name:'Create campaign'})).toBeNull()
  expect(document.querySelectorAll('[data-accounting-budget-id]')).toHaveLength(1)
  expect(api.authed.mock.calls.every(args=>args[1]==='/admin/catalog'&&args.length===2)).toBe(true)
  fireEvent.click(screen.getByRole('button',{name:'New campaign'}));expect(navigate).toHaveBeenCalledOnce()
})

it('saves an exact 18-decimal request fee without changing other program settings',async()=>{
  show();const input=await screen.findByLabelText('Request fee ETH for '+program.id)
  expect(input).toHaveValue('0.001000000000000001')
  fireEvent.change(input,{target:{value:'0.123456789012345678'}})
  fireEvent.click(screen.getByRole('button',{name:'Save request fee'}))
  await waitFor(()=>expect(api.authed).toHaveBeenCalledWith(account,'/admin/programs',{...program,requestFeeWei:'123456789012345678'}))
})

it('preserves a dirty fee across refresh and blocks saving a stale revision',async()=>{
  show();const input=await screen.findByLabelText('Request fee ETH for '+program.id)
  catalog.programs=[{...program,revision:2,requestFeeWei:'2000000000000000'}]
  fireEvent.click(screen.getByRole('button',{name:'Reload campaigns'}))
  await waitFor(()=>expect(input).toHaveValue('0.002'))
  fireEvent.change(input,{target:{value:'0.003'}})
  catalog.programs=[{...program,revision:3,requestFeeWei:'4000000000000000'}]
  fireEvent.click(screen.getByRole('button',{name:'Reload campaigns'}))
  await screen.findByRole('button',{name:'Use latest fee'})
  expect(input).toHaveValue('0.003');expect(screen.getByRole('button',{name:'Save request fee'})).toBeDisabled()
  fireEvent.click(screen.getByRole('button',{name:'Use latest fee'}));expect(input).toHaveValue('0.004')
  expect(api.authed.mock.calls.every(args=>args[1]==='/admin/catalog')).toBe(true)
})

it('retains a failed fee edit for correction without announcing success',async()=>{
  show();const input=await screen.findByLabelText('Request fee ETH for '+program.id)
  api.authed.mockRejectedValueOnce(Error('Program revision conflict.'))
  fireEvent.change(input,{target:{value:'0.005'}});fireEvent.click(screen.getByRole('button',{name:'Save request fee'}))
  await screen.findByText('Program revision conflict.')
  expect(input).toHaveValue('0.005');expect(screen.getByRole('button',{name:'Save request fee'})).toBeEnabled()
  expect(screen.queryByText('Campaign configuration saved.')).toBeNull()
})

it('creates only on explicit submission, preserves idempotency on failure, and excludes the calculated value',async()=>{
  show(true);await screen.findByRole('form',{name:'Create campaign'})
  expect(screen.queryByRole('table',{name:'Campaign configuration'})).toBeNull()
  expect(screen.getByLabelText('Campaign APR percent')).toHaveAttribute('readonly')
  expect(screen.getByRole('button',{name:'Create campaign'})).toBeDisabled()
  expect(api.authed).toHaveBeenCalledTimes(1)
  fireEvent.change(screen.getByLabelText('Campaign request fee ETH'),{target:{value:'0.000000000000000001'}})
  api.authed.mockRejectedValueOnce(Error('Reply unavailable; retry.'))
  fireEvent.click(screen.getByRole('button',{name:'Create campaign'}));await screen.findByText('Reply unavailable; retry.')
  const first=api.authed.mock.calls.find(args=>args[1]==='/admin/campaigns')![2]
  expect(first).toMatchObject({pairId:'pair-1',active:false,requestFeeWei:'1',days:3,budgetUsd:'10000',capacityUsd:'1000000'})
  expect(first).not.toHaveProperty('aprPercent');expect(first.creationKey).toMatch(/^[a-f0-9-]{36}$/)
  expect(navigate).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'Create campaign'}))
  await waitFor(()=>expect(navigate).toHaveBeenCalledOnce())
  const writes=api.authed.mock.calls.filter(args=>args[1]==='/admin/campaigns')
  expect(writes).toHaveLength(2);expect(writes[1][2]).toEqual(first)
})

it('clearly distinguishes calculated capacity and rejects invalid economics or fees',async()=>{
  show(true);await screen.findByRole('form',{name:'Create campaign'})
  fireEvent.change(screen.getByLabelText('Calculate campaign field'),{target:{value:'capacity'}})
  expect(screen.getByLabelText('Campaign capacity USD')).toHaveAttribute('readonly')
  expect(screen.getByLabelText('Campaign APR percent')).not.toHaveAttribute('readonly')
  fireEvent.change(screen.getByLabelText('Campaign request fee ETH'),{target:{value:'0.0000000000000000001'}})
  expect(screen.getByRole('button',{name:'Create campaign'})).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Campaign request fee ETH'),{target:{value:'0.001'}})
  fireEvent.change(screen.getByLabelText('Campaign duration'),{target:{value:'0'}})
  expect(screen.getByRole('button',{name:'Create campaign'})).toBeDisabled()
  fireEvent.change(screen.getByLabelText('Campaign duration'),{target:{value:'7'}})
  fireEvent.click(screen.getByRole('button',{name:'Create campaign'}))
  await waitFor(()=>expect(navigate).toHaveBeenCalledOnce())
  const payload=api.authed.mock.calls.find(args=>args[1]==='/admin/campaigns')![2]
  expect(payload).toMatchObject({days:7,aprPercent:'121.66666667',budgetUsd:'10000'})
  expect(payload).not.toHaveProperty('capacityUsd')
})

it('shows empty-pair and failed-catalog states without a creation form',async()=>{
  catalog.pairs=[];const view=show(true);await screen.findByText('No enabled pairs')
  expect(screen.queryByRole('form',{name:'Create campaign'})).toBeNull();view.unmount()
  api.authed.mockRejectedValueOnce(Error('Catalog unavailable.'));show(true);await screen.findByText('Catalog unavailable.')
  expect(screen.queryByRole('form',{name:'Create campaign'})).toBeNull()
})
