import { test,expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'

test('private advisory is confined to the operator portfolio; above-target quotes need no amount review',async({page})=>{
  const f=await setup(page,{admin:true,campaign:true})
  try{
    await page.goto(f.origin+'/admin');await connect(page)
    await page.getByRole('button',{name:'Sign in as operator',exact:true}).click()
    const q=await f.database.putQuote({offer:await f.database.offer('cashcat-3d'),principalCents:'9000000',wallet:f.account.address,
      origin:f.origin,signer:f.chain.account.address,recoveryHash:'0x'+'1'.repeat(64),
      plan:{premium:'1',premiumCents:'90000',liquidity:'1',sizingBlock:'0x1',usdCheckedAt:Date.now()}})
    // Database seam establishes the advisory; actual ETH payment coverage is in
    // the complete-cycle and multiple-request browser scenarios.
    const { mockPayment }=await import('../incentives-fixture.mjs')
    await f.database.acceptDeployment({wallet:q.wallet,quoteId:q.id,payment:mockPayment(q),origin:f.origin})
    await page.goto(f.origin+'/portfolio/vaults')
    await expect(page.locator('[data-capacity-advisory]')).toContainText('near capacity')
    await page.getByRole('button',{name:'Vaults',exact:true}).click()
    await expect(page.locator('[data-capacity-advisory]')).toHaveCount(0)
    await expect(page.getByText('Capacity',{exact:true})).toHaveCount(0)
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByLabel('Deposit value in US dollars').fill('200000')
    const dialog=page.getByRole('dialog')
    await expect(dialog.getByRole('button',{name:'Continue',exact:true})).toBeEnabled()
    await expect(dialog).not.toContainText(/capacity|amount review|available per vault/i)
    await dialog.getByRole('button',{name:'Continue',exact:true}).click()
    await expect(dialog.getByRole('button',{name:'Pay $2 in ETH',exact:true})).toBeEnabled()
    await expect(page.locator('[data-payment-waiting]')).toHaveCount(0)
  }finally{await f.close()}
})
