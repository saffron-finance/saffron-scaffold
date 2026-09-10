import { test,expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'

test('production runtime: user deployment, funding gate, shared profile entry, claim, maturity and withdrawal',async({page})=>{
  const f=await setup(page,{wrap:true})
  try{
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByLabel('Deposit value in US dollars').fill('100')
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Review deployment'})).toBeVisible()
    expect(f.state.sends).toBe(0)
    await expect(page.getByText('Pay request fee with',{exact:true})).toHaveCount(0)
    await page.getByRole('button',{name:'Authorize deployment',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
    const id=await page.locator('[data-vault-lifecycle]').getAttribute('data-vault-lifecycle')
    expect((await f.worker.tick()).state).toBe('created')
    await expect(page.getByRole('status',{name:''}).filter({hasText:'Awaiting admin funding'})).toBeVisible({timeout:20000})
    await expect(page.getByRole('button',{name:'Deposit',exact:true})).toHaveCount(0)
    const row=await f.database.getIntent(id)
    await f.database.execution.approveFunding(id,f.chain.account.address,row.plan_hash,row.plan.premium)
    expect((await f.worker.tick()).state).toBe('funded')
    await expect(page.getByRole('button',{name:'Wrap ETH',exact:true})).toBeEnabled({timeout:20000})
    await page.getByRole('button',{name:'Close incentive vault'}).click()
    await page.getByRole('button',{name:/^My vaults/}).click()
    await expect(page.getByRole('button',{name:'Deposit',exact:true})).toBeVisible({timeout:20000})
    await page.getByRole('button',{name:'Deposit',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toHaveAttribute('data-vault-lifecycle',id)
    for(const name of ['Wrap ETH','Approve CASHCAT','Approve ETH','Deposit']){
      const button=page.getByRole('dialog').getByRole('button',{name,exact:true});await expect(button).toBeEnabled({timeout:20000});await button.click()
    }
    await expect(page.getByRole('dialog').getByRole('button',{name:'Claim premium',exact:true})).toBeEnabled({timeout:20000})
    await page.getByRole('dialog').getByRole('button',{name:'Claim premium',exact:true}).click()
    await expect(page.getByRole('dialog').getByText('Position active',{exact:true})).toBeVisible({timeout:20000})
    const snapshot=await f.database.execution.observation(id)
    await f.advanceTo(Number(snapshot.endTime)+2)
    await page.getByRole('button',{name:'Sign in to continue',exact:true}).click()
    await expect(page.getByRole('dialog').getByRole('button',{name:'Withdraw LP assets',exact:true})).toBeEnabled({timeout:20000})
    await page.getByRole('dialog').getByRole('button',{name:'Withdraw LP assets',exact:true}).click()
    await expect(page.getByRole('dialog').getByText('Completed',{exact:true})).toBeVisible({timeout:20000})
    expect((await f.database.catalog(true)).budgets[0].allocatedRaw).toBe(row.plan.premium)
    expect(f.state.calls).not.toContain('eth_sendRawTransaction')
    expect(f.state.sends).toBe(6)
    await page.screenshot({path:'validation/completed-lifecycle.png',fullPage:true})
  }finally{await f.close()}
})

test('approved cards, mobile layout, keyboard focus and local lifecycle navigation',async({page})=>{
  const f=await setup(page)
  try{
    await page.goto(f.origin)
    const offers=page.locator('[data-incentive-offer]');await expect(offers).toHaveCount(4)
    await expect(offers.first()).toHaveCSS('border-top-color','rgb(29, 29, 29)')
    await offers.first().hover();await expect(offers.first()).toHaveCSS('border-top-color','rgb(69, 69, 69)')
    await page.emulateMedia({reducedMotion:'reduce'})
    for(const width of [1440,1000,800,390]){
      await page.setViewportSize({width,height:900})
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
    }
    await offers.first().focus();await page.keyboard.press('Enter')
    const dialog=page.getByRole('dialog');await expect(dialog).toBeVisible()
    expect(await dialog.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
    await page.screenshot({path:'validation/mobile-create.png',fullPage:true})
    await page.keyboard.press('Escape');await expect(dialog).toBeHidden();await expect(offers.first()).toBeFocused()
    await expect(page.locator('a[href*="beta.saffron.finance"]')).toHaveCount(0)
    await expect(page.getByRole('link',{name:'Variable yield',exact:true})).toHaveCount(0)
  }finally{await f.close()}
})
