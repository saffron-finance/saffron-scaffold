import { setup,connect } from './fixture.mjs'

/** Actual operator API + database + local EVM, with zero paid requests. Exercise
 * the startup blockers, real watcher checkpoint, worker heartbeat, and outages. */
export async function statusJourney(page,{expect,basePath='',merged=false,evidence}){
  const f=await setup(page,{admin:true,campaign:true,basePath}),errors=[]
  let heartbeat
  page.on('pageerror',error=>errors.push(error.message))
  try{
    expect((await page.request.get(f.origin+'/api/incentives/admin/health')).status()).toBe(401)
    const policy=await f.database.intakePolicy(f.chain.account.address)
    await f.operatorCall('/admin/intake',{signer:f.chain.account.address,revision:policy?.revision??0,mode:'automatic',enabled:true,expiresAt:new Date(Date.now()+3600000).toISOString(),serviceMinutes:240,watcherId:'native-eth-v1'})
    await page.goto(f.origin+'/status');await connect(page)
    await page.getByRole('button',{name:'Sign in as operator',exact:true}).click()
    await expect(page.locator('[data-status-check="creator"]')).toContainText('No heartbeat')
    await expect(page.locator('[data-status-check="watcher"]')).toContainText('no recorded scan')
    await expect(page.getByLabel('Request intake summary')).toContainText('Switch on')
    await expect(page.getByLabel('Request intake summary')).toContainText('Paid requests blocked')
    await expect(page.locator('[data-status-check="contracts"]')).toContainText('Ready')
    await expect(page.locator('[data-status-check="gas"]')).toContainText('Manual check')
    await expect(page.locator('[data-status-check="wallet"]')).toContainText('Robinhood · 4663')
    f.state.chain='0x1';await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await expect(page.locator('[data-status-check="wallet"]')).toContainText('Different wallet network')
    f.state.chain='0x1237';await page.evaluate(()=>window.dispatchEvent(new Event('focus')))
    await expect(page.locator('[data-status-check="wallet"]')).toContainText('Robinhood · 4663')
    if(merged){
      const names=await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link').allTextContents()
      const admin=names.findIndex(n=>n.trim()==='Administration')
      expect(names.slice(admin,admin+3).map(n=>n.trim())).toEqual(['Administration','Status','Journey Guide'])
    }
    if(evidence)await page.screenshot({path:evidence+'/status-desktop.png',fullPage:true})
    await page.setViewportSize({width:390,height:844})
    expect(await page.locator('main').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
    if(evidence)await page.screenshot({path:evidence+'/status-mobile.png',fullPage:true})
    await page.getByRole('button',{name:'Administration',exact:true}).first().click()
    await expect(page.getByRole('heading',{name:'Administration',exact:true})).toBeVisible()
    await expect(page.getByLabel('Operation metrics')).toContainText('0')
    await expect(page.getByLabel('Deployment queue')).toContainText('No deployment requests')
    await page.getByRole('button',{name:'Edit intake window',exact:true}).click()
    await expect(page.getByLabel('Execution mode')).toBeVisible()
    for(const name of ['Payments','Refunds','Campaigns','Overview'])await page.getByLabel('Administration sections').getByRole('button',{name,exact:true}).click()
    if(evidence){await page.setViewportSize({width:1440,height:1000});await page.screenshot({path:evidence+'/admin-desktop.png',fullPage:true})}
    await page.goto(f.origin+'/journey');await expect(page.getByRole('heading',{name:'Journey Guide',exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Status',exact:true}).first().click()
    await expect(page.getByRole('heading',{name:'Status',exact:true})).toBeVisible()
    // Real keyless scan and idle local creator tick: no quote, payment, or send.
    await f.worker.tick();await f.chain.prepareIntake(f.database,{mode:'automatic',continuous:true})
    heartbeat=setInterval(()=>void f.database.execution.heartbeat(f.chain.account.address).catch(()=>{}),3000)
    await page.getByRole('button',{name:'Refresh checks',exact:true}).click()
    await expect(page.getByLabel('Request intake summary')).toContainText('Paid requests enabled',{timeout:25000})
    await expect(page.locator('[data-status-check="watcher"]')).toContainText('Ready')
    await expect(page.locator('[data-status-check="premium"]')).toContainText('Manual check')
    await page.route('**/api/incentives/admin/health',route=>route.fulfill({status:503,json:{error:'Status unavailable'}}))
    await page.getByRole('button',{name:'Refresh checks',exact:true}).click()
    await expect(page.getByRole('alert').filter({hasText:'Status could not be verified'})).toBeVisible()
    await expect(page.getByLabel('Request intake summary')).toContainText('Not verified')
    await expect(page.getByLabel('Request intake summary')).not.toContainText('Paid requests enabled')
    expect((await f.database.query('SELECT count(*)::int count FROM saffron_incentives.deployment_quotes')).rows[0].count).toBe(0)
    expect((await f.database.query('SELECT count(*)::int count FROM saffron_incentives.deployment_intents')).rows[0].count).toBe(0)
    expect(f.state.signs).toBeGreaterThan(0);expect(f.state.sends).toBe(0);expect(errors).toEqual([])
    return {ok:true,merged,basePath,authenticated:true,anonymousStatus:401,blockedToReady:true,outageExplicit:true,mobileOverflow:false,walletTransactions:0,quotesCreated:0,errors}
  }finally{clearInterval(heartbeat);await f.close()}
}
