import { test,expect } from '@playwright/test'
import { toHex } from 'viem'
import { setup,connect } from './fixture.mjs'

test('operator prepares an exact external refund and observes verified closure without a browser payout',async({page})=>{
  const f=await setup(page,{admin:true,campaign:true})
  try{
    page.setDefaultTimeout(20000)
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await page.getByRole('dialog').getByRole('button',{name:/^(Pay \$2 in ETH|Claim \$[0-9.,]+)$/}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
    const job=(await f.database.list({wallet:f.account.address})).jobs[0]
    const payment=(await f.database.query('SELECT * FROM saffron_incentives.payment_obligations WHERE quote_id=$1',[job.quote_id])).rows[0]
    await page.goto(f.origin+'/admin')
    const login=page.getByRole('button',{name:'Sign in as operator',exact:true})
    await login.or(page.getByText('External creation-fee refunds',{exact:true})).first().waitFor()
    if(await login.isVisible())try{await login.click({timeout:5000})}catch{
      // A restored operator session may replace the transient login control
      // during its click. Accept only the authenticated administration view.
      await expect(page.getByText('External creation-fee refunds',{exact:true})).toBeVisible()
    }
    await page.getByText('External creation-fee refunds',{exact:true}).click()
    await page.getByRole('button',{name:'Load refundable requests and batches',exact:true}).click()
    await page.getByRole('checkbox',{name:new RegExp(job.id.slice(0,8))}).check()
    await page.getByLabel('Operator explanation',{exact:true}).fill('Deployment cannot be fulfilled')
    await page.getByRole('checkbox',{name:'External funder has stopped work for these requests',exact:true}).check()
    await page.getByRole('button',{name:'Approve selected full-fee refunds and stop creation',exact:true}).click()
    await page.getByLabel('Approved refund sender address',{exact:true}).fill(f.chain.feeRecipient)
    await page.getByRole('button',{name:'Prepare selected refund batch',exact:true}).click()
    await expect(page.getByRole('button',{name:'Download original batch CSV',exact:true})).toBeVisible()
    expect(f.state.sends).toBe(1)
    expect(await f.database.execution.claim(f.chain.account.address,'worker')).toBeNull()
    const source=f.chain.feeRecipient
    await f.chain.raw('anvil_setBalance',[source,toHex(10n**18n)])
    await f.chain.raw('anvil_impersonateAccount',[source])
    const hash=await f.chain.raw('eth_sendTransaction',[{from:source,to:f.account.address,value:toHex(BigInt(payment.amount_wei)),gas:'0x5208'}])
    await f.chain.raw('evm_mine',[])
    await page.getByLabel('External transaction hashes, one per line',{exact:true}).fill(hash)
    await page.getByRole('button',{name:'Record hashes for verification',exact:true}).click()
    await expect.poll(async()=>(await f.database.paymentObligation(payment.hash)).state,{timeout:30000}).toBe('refunded')
    await page.getByRole('button',{name:'Refresh refund verification',exact:true}).click()
    await expect(page.getByText(new RegExp(payment.hash.slice(0,10)+' · refunded'))).toBeVisible()
    expect(f.state.sends).toBe(1)
    await page.setViewportSize({width:390,height:844})
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  }finally{await f.close()}
})
