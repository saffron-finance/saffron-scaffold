import { setup,connect } from './fixture.mjs'

/** Exercise the real wallet login and production diagnostics endpoint against
 * disposable infrastructure. Only the outage response is intercepted. */
export async function configurationJourney(page,{expect,missingFeeRecipient,basePath='',campaignPage=false,screenshot}){
  const f=await setup(page,{admin:true,missingFeeRecipient,basePath})
  const errors=[];page.on('pageerror',error=>errors.push(error.message))
  try{
    const anonymous=await page.request.get(f.origin+'/api/incentives/admin/configuration')
    expect(anonymous.status()).toBe(401)
    await page.goto(f.origin+'/admin')
    await expect(page.getByText('Sign in with an admin wallet to check server settings.',{exact:false})).toBeVisible()
    await connect(page)
    // A status outage must not hide diagnostics or force an authentication bypass.
    await page.route('**/api/incentives/admin/status',route=>route.fulfill({status:503,json:{error:'Operations unavailable'}}))
    await page.getByRole('button',{name:'Sign in as operator',exact:true}).click()
    const panel=page.getByRole('alert').filter({has:page.getByText('Configuration needs attention',{exact:true})})
    const fee=panel.locator('li').filter({hasText:'SAFFRON_CREATION_FEE_RECIPIENT'})
    if(missingFeeRecipient){await expect(fee).toContainText('Required setting · missing');await expect(fee).toContainText('New paid requests are blocked')}
    else{await expect.poll(async()=>await panel.locator('details').textContent()).toContain('SAFFRON_CREATION_FEE_RECIPIENT — configured');await expect(fee).toHaveCount(0)}
    const report=await f.operatorCall('/admin/configuration')
    expect(report.settings.find(row=>row.name==='SAFFRON_CREATION_FEE_RECIPIENT').status).toBe(missingFeeRecipient?'missing':'configured')
    expect(report.settings.find(row=>row.name==='PGPASSWORD').status).toBe('default')
    expect(f.state.signs).toBeGreaterThan(0);expect(f.state.sends).toBe(0)
    await page.setViewportSize({width:390,height:844})
    expect(await panel.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
    if(screenshot)await page.screenshot({path:screenshot,fullPage:true})
    if(campaignPage){
      await page.goto(f.origin+'/campaigns')
      await expect(panel).toContainText('SAFFRON_CREATION_FEE_RECIPIENT')
      await expect(page.getByRole('form',{name:'Create campaign'})).toBeVisible()
    }
    await page.route('**/api/incentives/admin/configuration',route=>route.fulfill({status:503,json:{error:'Configuration unavailable'}}))
    await page.getByRole('button',{name:'Recheck configuration'}).click()
    await expect(panel).toContainText('Cannot verify the current server settings')
    await expect(panel).toContainText('may be out of date')
    expect(errors).toEqual([]);expect(f.state.sends).toBe(0)
    return {missingFeeRecipient,walletSignatures:f.state.signs,walletTransactions:f.state.sends,anonymousStatus:anonymous.status(),mobileOverflow:false,statusOutageIsolated:true,configurationOutageExplicit:true,campaignPage}
  }finally{await f.close()}
}
