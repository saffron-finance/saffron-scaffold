import {cleanup,render,screen,within} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import {ThemeProvider} from 'styled-components'
import {darkTheme} from '@fixed/shared/styles/themes/darkTheme'
import {FundingAccounting,accountingUsd} from './FundingAccounting'
import type {Budget,RequestStatistics} from './model'

const statistics:RequestStatistics={scope:'all-accepted-requests',requestCount:'3',totalLpCents:'130001',averageLpCents:'43334',maximumLpCents:'90000',totalPremiumCents:'1310',averagePremiumCents:'437',maximumPremiumCents:'907',unvaluedLpRequests:'0',unvaluedPremiumRequests:'0'}
const budget={id:'campaign-one',name:'TEST / USD',advisoryBudgetCents:'123456',campaign:{budgetCents:'1000000',capacityCents:'100000000'},accounting:{budgetCents:'1000000',fundedBudgetCents:'500',reservedBudgetCents:'700',fundedCapacityCents:'80000',reservedCapacityCents:'50001',targetCapacityCents:'100000000',availableCapacityCents:'-15981434',fixedDepositedCents:'30001'},requestStatistics:statistics} as Budget
function show(value:Budget=budget){return render(<ThemeProvider theme={darkTheme}><FundingAccounting budget={value}/></ThemeProvider>)}
const row=(name:string)=>screen.getByRole('rowheader',{name:new RegExp(name+'$')}).closest('tr')!
afterEach(cleanup)

it('uses the edited planning budget and displays four headlines with complete request statistics',()=>{
 show()
 const highlights=screen.getByLabelText('Funding highlights')
 expect(within(highlights).getByText('$1,234.56')).toBeVisible()
 expect(within(highlights).queryByText('$10,000.00')).toBeNull()
 expect(within(highlights).getByText('$13.10')).toBeVisible()
 expect(within(highlights).getByText('3',{exact:true})).toBeVisible()
 for(const [name,value]of [['LP requests','3'],['Average LP size','$433.34'],['Maximum LP size','$900.00'],['Total LP requested','$1,300.01'],['Average premium request','$4.37'],['Maximum premium request','$9.07'],['Total premium requested','$13.10'],['Premium reserved','$7.00'],['Remaining target LP capacity','-$159,814.34'],['Original premium budget','$10,000.00']])expect(within(row(name)).getByText(value,{exact:true})).toBeVisible()
 expect(screen.getByText(/Unpaid quotes are excluded/)).toBeVisible()
 expect(screen.getByText(/exclude the ETH request fee and wallet gas/)).toBeVisible()
})

it('falls back to the original budget only when no edited planning target exists',()=>{
 show({...budget,advisoryBudgetCents:undefined})
 expect(within(screen.getByLabelText('Funding highlights')).getByText('$10,000.00')).toBeVisible()
})

it('distinguishes empty request history from missing API evidence',()=>{
 const empty={...statistics,requestCount:'0',totalLpCents:'0',totalPremiumCents:'0',averageLpCents:null,maximumLpCents:null,averagePremiumCents:null,maximumPremiumCents:null}
 const view=show({...budget,requestStatistics:empty})
 expect(within(row('Average LP size')).getByText('—')).toBeVisible()
 expect(within(row('Total LP requested')).getByText('$0.00')).toBeVisible()
 view.unmount();show({...budget,requestStatistics:undefined})
 expect(within(row('LP requests')).getByText('Unavailable')).toBeVisible()
 expect(within(row('Total LP requested')).getByText('Unavailable')).toBeVisible()
 expect(screen.getByRole('status')).toHaveTextContent('Request statistics are unavailable')
})

it('preserves incomplete valuations as unknown without hiding the known request count',()=>{
 show({...budget,requestStatistics:{...statistics,totalPremiumCents:null,averagePremiumCents:null,maximumPremiumCents:null,unvaluedPremiumRequests:'1'}})
 expect(within(row('LP requests')).getByText('3')).toBeVisible()
 expect(within(row('Total premium requested')).getByText('Unavailable')).toBeVisible()
 expect(screen.getByRole('status')).toHaveTextContent('lack a recorded USD valuation')
})

it('formats exact cents including negatives and values above Number.MAX_SAFE_INTEGER',()=>{
 expect(accountingUsd('900719925474099301')).toBe('$9,007,199,254,740,993.01')
 expect(accountingUsd('-1')).toBe('-$0.01');expect(accountingUsd('0')).toBe('$0.00')
 expect(accountingUsd(null)).toBe('Unavailable');expect(accountingUsd('NaN')).toBe('Unavailable')
})
