import { test,expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { setup,connect } from './fixture.mjs'

test('a larger amount waits unpaid, resumes after reload and reaches the ordinary payment review after operator admission',async({page})=>{
  const f=await setup(page,{campaign:true})
  try{
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByLabel('Deposit value in US dollars').fill('50000')
    await page.getByRole('button',{name:'Request amount review',exact:true}).click()
    await expect(page.getByText('Amount review: pending.',{exact:false})).toBeVisible()
    expect((await f.database.query('SELECT count(*)::int n FROM saffron_incentives.deployment_quotes')).rows[0].n).toBe(0)
    expect(f.state.sends).toBe(0)
    const row=(await f.operatorCall('/admin/amount-reviews')).reviews[0]
    await f.operatorCall('/admin/amount-reviews/'+row.id,{revision:row.revision,action:'approve',reason:'Review large fixture position',requestKey:randomUUID()})
    await page.reload();await page.getByRole('button',{name:'Resume checkout',exact:true}).click()
    await page.getByRole('button',{name:'Check amount review',exact:true}).click()
    await expect(page.getByText('Amount review: approved.',{exact:false})).toBeVisible()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await expect(page.getByRole('button',{name:'Pay $2 in ETH',exact:true})).toBeEnabled()
    expect(f.state.sends).toBe(0);expect(f.state.signs).toBe(0)
    const quotes=(await f.database.query('SELECT body FROM saffron_incentives.deployment_quotes')).rows
    expect(quotes).toHaveLength(1);expect(quotes[0].body.admissionId).toBe(row.id);expect(quotes[0].body.principalCents).toBe('5000000')
  }finally{await f.close()}
})
