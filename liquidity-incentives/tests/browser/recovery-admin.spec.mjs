import { test,expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'

test('lost acceptance response and lost wallet response survive reload without another payment or transaction',async({page})=>{
  const f=await setup(page)
  try{
    await page.goto(f.origin);await connect(page)
    let lose=true
    await page.route('**/api/incentives/deployments',async route=>{
      if(route.request().method()==='POST'&&lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(201);await route.fulfill({status:503,json:{error:'Simulated lost response'}})}else await route.continue()
    })
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByRole('button',{name:'Pay $2 in ETH',exact:true}).click()
    await expect(page.getByText('Simulated lost response',{exact:true})).toBeVisible()
    const signs=f.state.signs
    await page.reload();await page.getByRole('button',{name:'Resume deployment',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Check payment',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
    expect(f.state.signs).toBe(0)
    expect(f.state.sends).toBe(1)
    const {jobs:rows}=await f.database.list({wallet:f.account.address});expect(rows).toHaveLength(1)
    const id=rows[0].id
    expect((await f.worker.tick()).state).toBe('created')
    const job=await f.database.getIntent(id)
    await f.chain.fund(job)
    expect((await f.worker.tick()).state).toBe('idle')
    f.state.lostSend=true
    await page.getByRole('button',{name:'Approve CASHCAT',exact:true}).click()
    await expect(page.getByRole('button',{name:'Check transaction',exact:true})).toBeVisible()
    const hash=f.state.lastHash
    await page.reload()
    await page.getByRole('button',{name:/^My requests/}).click()
    await page.getByRole('button',{name:'Deposit',exact:true}).click()
    await page.getByLabel('Recover transaction hash').fill(hash)
    await page.getByRole('button',{name:'Check transaction',exact:true}).click()
    await expect(page.getByRole('button',{name:'Approve ETH',exact:true})).toBeEnabled({timeout:20000})
    expect(f.state.sends).toBe(2)
    expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('saffron.position-action.v1:')))).toHaveLength(0)
  }finally{await f.close()}
})

test('campaign form derives APR, budget or capacity and stores a paused campaign without moving funds',async({page})=>{
  const f=await setup(page,{admin:true})
  try{
    await page.goto(f.origin+'/admin');await connect(page)
    await page.getByRole('button',{name:'Sign in as operator',exact:true}).click()
    await page.getByText('Programs and campaign budgets',{exact:true}).click()
    await page.getByRole('button',{name:'Load incentive catalog',exact:true}).click()
    await page.getByLabel('Campaign ID',{exact:true}).fill('new-campaign')
    await page.getByLabel('Campaign name',{exact:true}).fill('New campaign')
    await expect(page.getByLabel('Campaign APR percent')).toHaveValue('121.666667')
    await expect(page.getByLabel('Campaign APR percent')).toHaveAttribute('readonly','')
    await page.getByLabel('Calculate campaign field').selectOption('capacity')
    await page.getByLabel('Campaign APR percent').fill('100')
    await expect(page.getByLabel('Campaign capacity USD')).toHaveValue('1216666.66')
    await page.getByLabel('Calculate campaign field').selectOption('budget')
    await expect(page.getByLabel('Campaign budget USD')).toHaveValue('8219.18')
    await page.getByLabel('Calculate campaign field').selectOption('apr')
    await page.getByRole('button',{name:'Create campaign',exact:true}).click()
    await expect(page.getByText('Campaign configuration saved.',{exact:true})).toBeVisible()
    const catalog=await f.database.catalog(true),campaign=catalog.budgets.find(b=>b.id==='new-campaign')
    expect(campaign.campaign.budgetCents).toBe('1000000')
    expect(campaign.campaign.capacityCents).toBe('100000000')
    expect(campaign.paused).toBe(true)
    expect(f.state.sends).toBe(0)
    await page.setViewportSize({width:390,height:844})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:'validation/admin-budgets-mobile.png',fullPage:true,animations:'disabled'})
  }finally{await f.close()}
})

test('a lost ETH-payment wallet response restores from its hash with zero message signatures and one fee',async({page})=>{
  const f=await setup(page)
  try{
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    f.state.lostSend=true
    await page.getByRole('button',{name:'Pay $2 in ETH',exact:true}).click()
    await expect(page.getByRole('button',{name:'Check payment',exact:true})).toBeVisible()
    const hash=f.state.lastHash;expect(hash).toMatch(/^0x/)
    await page.reload();await page.getByRole('button',{name:'Resume deployment',exact:true}).click()
    await page.getByLabel('Payment transaction hash',{exact:true}).fill(hash)
    await page.getByRole('button',{name:'Check payment',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
    expect(f.state.sends).toBe(1);expect(f.state.signs).toBe(0)
    expect((await f.database.list({wallet:f.account.address})).jobs).toHaveLength(1)
  }finally{await f.close()}
})
