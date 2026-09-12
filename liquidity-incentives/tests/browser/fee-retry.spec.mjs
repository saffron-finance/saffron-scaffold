import { test,expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'

test('a missing response before broadcast explicitly retries the same fee nonce after reload',async({page})=>{
  const f=await setup(page)
  try{
    page.setDefaultTimeout(20000)
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    f.state.failBeforeSend=true
    await page.getByRole('dialog').getByRole('button',{name:/^(Pay \$2 in ETH|Claim \$[0-9.,]+)$/}).click()
    await expect(page.getByRole('button',{name:'Check payment',exact:true})).toBeVisible()
    const records=()=>page.evaluate(account=>JSON.parse(localStorage.getItem('saffron.creation-payments.v1:'+account.toLowerCase())),f.account.address)
    const saved=Object.values((await records()).records)[0]
    expect(saved.nonce).toBe(0);expect(saved.hash).toBeFalsy();expect(f.state.sends).toBe(1)
    await page.reload();await page.getByRole('button',{name:'Resume deployment',exact:true}).click()
    await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))
    expect(f.state.sends).toBe(1)
    await page.getByText('Recover a missing transaction response',{exact:true}).click()
    await page.getByRole('button',{name:'Retry same payment',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
    const tx=await f.chain.raw('eth_getTransactionByHash',[f.state.lastHash])
    expect(BigInt(tx.nonce)).toBe(0n)
    expect((await f.database.list({wallet:f.account.address})).jobs).toHaveLength(1)
    expect((await f.database.query('SELECT count(*)::int n FROM saffron_incentives.deployment_quotes')).rows[0].n).toBe(1)
    expect(Object.keys((await records()).records)).toHaveLength(1)
    expect(f.state.sends).toBe(2);expect(f.state.signs).toBe(0)
  }finally{await f.close()}
})
