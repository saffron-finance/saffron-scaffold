import { test,expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'

test('lost acceptance response and lost wallet response survive reload without another authorization or transaction',async({page})=>{
  const f=await setup(page)
  try{
    await page.goto(f.origin);await connect(page)
    let lose=true
    await page.route('**/api/incentives/deployments',async route=>{
      if(route.request().method()==='POST'&&lose){lose=false;const response=await route.fetch();expect(response.status()).toBe(201);await route.fulfill({status:503,json:{error:'Simulated lost response'}})}else await route.continue()
    })
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByRole('button',{name:'Authorize deployment',exact:true}).click()
    await expect(page.getByText('Simulated lost response',{exact:true})).toBeVisible()
    const signs=f.state.signs
    await page.reload();await page.getByRole('button',{name:'Resume deployment',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:'Resume deployment',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
    expect(f.state.signs).toBe(signs)
    const {jobs:rows}=await f.database.list({wallet:f.account.address});expect(rows).toHaveLength(1)
    const id=rows[0].id
    expect((await f.worker.tick()).state).toBe('created')
    const job=await f.database.getIntent(id)
    await f.database.execution.approveFunding(id,f.chain.account.address,job.plan_hash,job.plan.premium)
    expect((await f.worker.tick()).state).toBe('funded')
    f.state.lostSend=true
    await page.getByRole('button',{name:'Approve CASHCAT',exact:true}).click()
    await expect(page.getByRole('button',{name:'Check transaction',exact:true})).toBeVisible()
    const hash=f.state.lastHash
    await page.reload()
    await page.getByRole('button',{name:/^My vaults/}).click()
    await page.getByRole('button',{name:'Deposit',exact:true}).click()
    await page.getByLabel('Recover transaction hash').fill(hash)
    await page.getByRole('button',{name:'Check transaction',exact:true}).click()
    await expect(page.getByRole('button',{name:'Approve ETH',exact:true})).toBeEnabled({timeout:20000})
    expect(f.state.sends).toBe(1)
    expect(await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('saffron.position-action.v1:')))).toHaveLength(0)
  }finally{await f.close()}
})

test('operator catalog edits exact cumulative budgets and programs without an admin creation form',async({page})=>{
  const f=await setup(page,{admin:true})
  try{
    await page.goto(f.origin+'/admin');await connect(page)
    await page.getByRole('button',{name:'Sign in as operator',exact:true}).click()
    await page.getByText('Programs and campaign budgets',{exact:true}).click()
    await page.getByRole('button',{name:'Load incentive catalog',exact:true}).click()
    await page.getByRole('button',{name:'Add budget',exact:true}).click()
    await page.getByLabel('Budget ID',{exact:true}).fill('new-campaign')
    await page.getByLabel('Campaign name',{exact:true}).fill('New campaign')
    await page.getByLabel('Cumulative token limit',{exact:true}).fill('10.25')
    await page.getByLabel('Pause new deployments and funding',{exact:true}).uncheck()
    await page.getByRole('button',{name:'Save budget',exact:true}).click()
    await expect(page.getByText('Catalog saved. Updated offers are now available.',{exact:true})).toBeVisible()
    let catalog=await f.database.catalog(true)
    expect(catalog.budgets.find(b=>b.id==='new-campaign').limitRaw).toBe('10250000000000000000')
    await page.getByRole('button',{name:'Add program',exact:true}).click()
    await page.getByLabel('Program ID',{exact:true}).fill('new-program')
    await page.getByLabel('Campaign budget',{exact:true}).selectOption('new-campaign')
    await page.getByLabel('Minimum vault size (USD)',{exact:true}).fill('1.25')
    await page.getByLabel('Maximum vault size (USD)',{exact:true}).fill('2.50')
    await page.getByRole('button',{name:'Save program',exact:true}).click()
    await expect(page.getByText('Catalog saved. Updated offers are now available.',{exact:true})).toBeVisible()
    catalog=await f.database.catalog(true)
    expect(catalog.programs.find(p=>p.id==='new-program').minimumCents).toBe('125')
    expect(catalog.programs.find(p=>p.id==='new-program').maximumCents).toBe('250')
    await expect(page.getByRole('button',{name:'Approve creation',exact:true})).toHaveCount(0)
    expect(f.state.sends).toBe(0)
    await page.setViewportSize({width:390,height:844})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    await page.screenshot({path:'validation/admin-budgets-mobile.png',fullPage:true,animations:'disabled'})
  }finally{await f.close()}
})
