import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react'
import {afterEach,beforeEach,expect,it,vi} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {ProgramAdmin} from './ProgramAdmin'
import {RefundAdmin} from './RefundAdmin'

// Acceptance cases written before the P3/R1 layout change. Existing financial
// contract cases live in ProgramManagement/IncentivePrograms/RefundAdmin tests.
const api=vi.hoisted(()=>({authed:vi.fn()}))
vi.mock('../host/transport',()=>({authedJson:api.authed}))
vi.mock('./ConfigurationWarnings',()=>({ConfigurationWarnings:()=>null}))
vi.mock('./DeployerBalance',()=>({ProgramDeployerBalance:()=>null}))
const account='0x1111111111111111111111111111111111111111'
const pair={id:'pair',revision:1,chainId:4663,pool:account,feeTier:3000,active:true,token0:{address:account,symbol:'CASHCAT',decimals:18},token1:{address:account,symbol:'USDG',decimals:18}}
const programs=[1,2].map(i=>({id:'campaign-'+i,revision:4,pairId:'pair',budgetPoolId:'budget-'+i,apr:i===1?500:1000,days:i===1?7:3,requestFeeWei:String(i*1000000000000000),minimumCents:'1',maximumCents:'10000000',sortOrder:i,isNew:false,active:i===1}))
const budgets=programs.map((p,i)=>({id:p.budgetPoolId,name:'Program budget '+i,revision:8,chainId:4663,rewardAsset:account,decimals:18,limitRaw:'0',reservedRaw:'0',allocatedRaw:'0',availableRaw:'0',paused:i===1,reconciliationRequired:false,advisoryBudgetCents:'1000000',campaign:{days:p.days,budgetCents:'1000000',capacityCents:'100000000',aprPercent:String(p.apr)}}))
const payments=[{hash:'0x'+'1'.repeat(64),deployment_id:'request-one',wallet:account,revision:1,state:'admitted',amount_wei:'4000000000000001'},{hash:'0x'+'2'.repeat(64),deployment_id:'request-two',wallet:account,revision:2,state:'needs_attention',amount_wei:'200000000000002'},{hash:'0x'+'3'.repeat(64),deployment_id:'request-three',wallet:account,revision:1,state:'refund_pending',amount_wei:'9'}]
const show=(section:'programs'|'refunds')=>render(<ThemeProvider theme={darkTheme}>{section==='programs'?<ProgramAdmin account={account} onConnect={()=>{}} onCreate={()=>{}} autoLoad/>:<RefundAdmin account={account}/>}</ThemeProvider>)
beforeEach(()=>{history.replaceState(null,'','/admin');api.authed.mockReset();api.authed.mockImplementation(async(_account,path)=>path==='/admin/catalog'?{pairs:[pair],programs,budgets}:path.startsWith('/admin/payments?')?{payments:structuredClone(payments),nextCursor:'next-page'}:{batches:[]})})
afterEach(cleanup)

it('P3 keeps the navigator and search visible while editing, without filtering away an unsaved draft',async()=>{
 show('programs');fireEvent.click(await screen.findByRole('button',{name:'Open incentive program program-1'}))
 const navigator=screen.getByRole('list',{name:'Incentive programs'})
 expect(navigator).toBeVisible();expect(within(navigator).getByRole('button',{name:'Open incentive program program-1'})).toHaveAttribute('aria-pressed','true')
 const input=screen.getByLabelText('Request fee ETH for program-1');fireEvent.change(input,{target:{value:'0.125'}})
 fireEvent.change(screen.getByRole('searchbox',{name:'Find a program'}),{target:{value:'3 days'}})
 expect(within(navigator).getAllByRole('listitem')).toHaveLength(1);expect(input).toHaveValue('0.125')
 expect(screen.getByRole('region',{name:'Incentive program details'})).toHaveAttribute('data-program-id','campaign-1')
 expect(api.authed.mock.calls.every(call=>call.length===2)).toBe(true)
})
it('P3 switches programs directly from the navigator with identity-scoped fee and planning drafts',async()=>{
 show('programs');fireEvent.click(await screen.findByRole('button',{name:'Open incentive program program-1'}))
 fireEvent.change(screen.getByLabelText('Request fee ETH for program-1'),{target:{value:'0.9'}})
 fireEvent.click(screen.getByRole('button',{name:'Open incentive program program-2'}))
 expect(screen.getByLabelText('Request fee ETH for program-2')).toHaveValue('0.002');expect(screen.getByRole('button',{name:'Save request fee'})).toBeDisabled()
 expect(location.hash).toBe('#program/program-2')
 expect(within(screen.getByRole('region',{name:'Incentive program details'})).getByText('Premium funded')).toBeVisible()
 expect(within(screen.getByRole('region',{name:'Incentive program details'})).getAllByText('Unavailable')).toHaveLength(3)
})
it('R1 shows unknown summaries before an explicit read, then exact original-fee totals and separate workflow regions',async()=>{
 show('refunds');expect(screen.getByRole('heading',{name:'Refund requests'})).toBeVisible();const summary=screen.getByLabelText('Refund summary')
 expect(summary).not.toHaveTextContent('0 ETH');expect(api.authed).not.toHaveBeenCalled()
 fireEvent.click(screen.getByRole('button',{name:'Load refund requests'}));await screen.findByRole('table',{name:'Refund requests'})
 fireEvent.click(screen.getByRole('checkbox',{name:'Select refund request '+payments[0].hash}));fireEvent.click(screen.getByRole('checkbox',{name:'Select refund request '+payments[1].hash}))
 expect(within(summary).getByText('0.004200000000000003')).toBeVisible()
 expect(screen.getByRole('region',{name:'Review selected refunds'})).toBeVisible();expect(screen.getByRole('region',{name:'Prepare refund batch'})).toBeVisible()
 expect(screen.getByText(/Loaded requests only/)).toBeVisible();expect(screen.getByText('Approval stops creation. It does not send funds.')).toBeVisible()
})
it('R1 retains evidence after a failed refresh but blocks approval and preparation until a successful read',async()=>{
 show('refunds');fireEvent.click(screen.getByRole('button',{name:'Load refund requests'}));await screen.findByRole('table',{name:'Refund requests'})
 fireEvent.click(screen.getByRole('checkbox',{name:'Select refund request '+payments[0].hash}));fireEvent.change(screen.getByLabelText('Operator explanation'),{target:{value:'Funding unavailable'}});fireEvent.click(screen.getByRole('checkbox',{name:/External funder has stopped work/}))
 expect(screen.getByRole('button',{name:'Approve selected full-fee refunds and stop creation'})).toBeEnabled()
 api.authed.mockRejectedValueOnce(Error('Read unavailable'));fireEvent.click(screen.getByRole('button',{name:'Refresh refunds'}));await screen.findByRole('alert')
 expect(screen.getByRole('table',{name:'Refund requests'})).toBeVisible();expect(screen.getByRole('button',{name:'Approve selected full-fee refunds and stop creation'})).toBeDisabled()
 fireEvent.click(screen.getByRole('button',{name:'Refresh refunds'}));await waitFor(()=>expect(screen.getByRole('button',{name:'Approve selected full-fee refunds and stop creation'})).toBeEnabled())
})

it('R1 approval amount excludes already-approved selections while the overall selection total includes them',async()=>{
 show('refunds');fireEvent.click(screen.getByRole('button',{name:'Load refund requests'}));await screen.findByRole('table',{name:'Refund requests'})
 for(const row of payments)fireEvent.click(screen.getByRole('checkbox',{name:'Select refund request '+row.hash}))
 expect(within(screen.getByLabelText('Refund summary')).getByText('0.004200000000000012')).toBeVisible()
 expect(within(screen.getByRole('region',{name:'Review selected refunds'})).getByText('0.004200000000000003')).toBeVisible()
})

it('P3 resets a planning draft on program switches even when both programs share a budget',async()=>{
 const previous=programs[1].budgetPoolId;programs[1].budgetPoolId=programs[0].budgetPoolId
 try{
  show('programs');fireEvent.click(await screen.findByRole('button',{name:'Open incentive program program-1'}))
  fireEvent.change(screen.getByLabelText('Planning budget for program-1'),{target:{value:'888'}})
  fireEvent.click(screen.getByRole('button',{name:'Open incentive program program-2'}))
  expect(screen.getByLabelText('Planning budget for program-2')).toHaveValue('10000')
  expect(api.authed.mock.calls.every(call=>call.length===2)).toBe(true)
 }finally{programs[1].budgetPoolId=previous}
})
