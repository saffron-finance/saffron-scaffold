import { test,expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'

test('an interrupted quote review resumes its durable checkout after reload without another hold',async({page})=>{
  const f=await setup(page)
  try{
    await page.goto(f.origin);await connect(page)
    let lose=true
    await page.route('**/api/incentives/deployment-quotes',async route=>{
      if(lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(200);await route.fulfill({status:503,json:{error:'Quote response lost'}})}else await route.continue()
    })
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await expect(page.getByText('Quote response lost',{exact:true})).toBeVisible()
    await page.reload();await page.getByRole('button',{name:'Resume checkout',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await expect(page.getByRole('button',{name:'Pay request fee',exact:true})).toBeEnabled()
    expect((await f.database.query('SELECT count(*)::int n FROM saffron_incentives.deployment_quotes')).rows[0].n).toBe(1)
    expect(f.state.sends).toBe(0)
  }finally{await f.close()}
})

test('a stale tab can start another paid request without deleting the previous recovery record',async({page,context})=>{
  const f=await setup(page)
  try{
    await page.goto(f.origin);await connect(page)
    const stale=await context.newPage()
    await stale.addInitScript(()=>window.addEventListener('storage',event=>event.stopImmediatePropagation(),true))
    await stale.goto(f.origin)
    await expect(stale.getByRole('button',{name:'Create CASHCAT / ETH, 7 days',exact:true})).toBeVisible()
    await page.route('**/api/incentives/payments/recover',route=>route.fulfill({json:{state:'discovering'}}))
    await page.route('**/api/incentives/deployments',async route=>{
      if(route.request().method()==='POST'){const response=await route.fetch();expect([200,201]).toContain(response.status());await route.fulfill({status:503,json:{error:'Acceptance response lost'}})}else await route.continue()
    })
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByRole('button',{name:'Pay request fee',exact:true}).click()
    await expect(page.getByText('Acceptance response lost',{exact:true})).toBeVisible()
    await stale.getByRole('button',{name:'Create CASHCAT / ETH, 7 days',exact:true}).click()
    await expect(stale.getByRole('button',{name:'Continue',exact:true})).toBeEnabled()
    await stale.getByRole('button',{name:'Continue',exact:true}).click()
    await stale.getByRole('button',{name:'Pay request fee',exact:true}).click()
    await expect(stale.locator('[data-vault-lifecycle]')).toBeVisible()
    expect(f.state.sends).toBe(2);expect((await f.database.list({wallet:f.account.address})).jobs).toHaveLength(2)
    const ledger=await stale.evaluate(account=>JSON.parse(localStorage.getItem('saffron.creation-payments.v1:'+account.toLowerCase())),f.account.address)
    expect(ledger.activeId).toBeNull();expect(Object.keys(ledger.records)).toHaveLength(2)
    expect(Object.values(ledger.records).filter(p=>p.hash)).toHaveLength(2)
    await stale.getByRole('button',{name:'Close incentive vault'}).click()
    await stale.getByRole('button',{name:/^My requests/}).click()
    await stale.getByRole('button',{name:'Check saved payment',exact:true}).click()
    await stale.getByRole('button',{name:'Check payment',exact:true}).click()
    await expect(stale.locator('[data-vault-lifecycle]')).toBeVisible()
    expect(f.state.sends).toBe(2)
  }finally{await f.close()}
})

test('lost acceptance response and lost wallet response survive reload without another payment or transaction',async({page})=>{
  const f=await setup(page)
  try{
    await page.goto(f.origin);await connect(page)
    let lose=true
    await page.route('**/api/incentives/payments/recover',route=>route.fulfill({json:{state:'discovering'}}))
    await page.route('**/api/incentives/deployments',async route=>{
      if(route.request().method()==='POST'&&lose){lose=false;const response=await route.fetch();expect([200,201]).toContain(response.status());await route.fulfill({status:503,json:{error:'Simulated lost response'}})}else await route.continue()
    })
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByRole('button',{name:'Pay request fee',exact:true}).click()
    await expect(page.getByText('Simulated lost response',{exact:true})).toBeVisible()
    const signs=f.state.signs
    await page.reload();await page.getByRole('button',{name:'Resume deployment',exact:true}).click()
    await page.unroute('**/api/incentives/payments/recover')
    await page.getByRole('button',{name:'Check payment',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toBeVisible({timeout:20000})
    expect(f.state.signs).toBe(0)
    expect(f.state.sends).toBe(1)
    const {jobs:rows}=await f.database.list({wallet:f.account.address});expect(rows).toHaveLength(1)
    const id=rows[0].id
    expect((await f.worker.tick()).state).toBe('created')
    const job=await f.database.getIntent(id)
    await f.chain.fund(job)
    expect((await f.worker.tick()).state).toBe('idle')
    await page.getByRole('button',{name:'Deposit LP assets',exact:true}).click()
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
    await page.getByLabel('Campaign request fee ETH').fill('0.001')
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
    await page.route('**/api/incentives/payments/recover',route=>route.fulfill({json:{state:'discovering'}}))
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    f.state.lostSend=true
    await page.getByRole('button',{name:'Pay request fee',exact:true}).click()
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
