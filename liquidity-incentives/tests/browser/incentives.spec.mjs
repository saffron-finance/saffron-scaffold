import { test,expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'
import { encodeAbiParameters,encodeFunctionData,parseAbi } from 'viem'
import { createIncentivesService } from '../../server/incentives-service.mjs'
import { deploymentTypedData } from '../../shared/incentives.mjs'
import { abi } from '../../shared/vault-lifecycle.mjs'
import { amountsForLiquidity } from '../../shared/liquidity-math.mjs'

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
    if(process.env.SAFFRON_TEST_LAB==='1'){
      await page.getByText('Tweak',{exact:true}).click()
      await page.getByLabel('Table font',{exact:true}).selectOption({index:1})
      await expect(page.locator('[data-incentive-programs]')).toHaveCSS('font-family',/Saffron tweak/)
      await page.getByText('Tweak',{exact:true}).click()
    }else await expect(page.getByText('Tweak',{exact:true})).toHaveCount(0)
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

test('a received claim appears in the holder profile and uses the native claim modal',async({page})=>{
  const f=await setup(page)
  try{
    const {chain,database}=f
    const service=createIncentivesService({database,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,origin:f.origin})
    const quote=await service.quote(chain.account.address,'cashcat-3d','100')
    const {id}=await database.acceptDeployment({wallet:chain.account.address,quoteId:quote.id,signature:await chain.account.signTypedData(deploymentTypedData(quote)),origin:f.origin})
    await f.worker.tick()
    const row=await service.detail(id,chain.account.address)
    await service.fund(id,chain.account.address,row.planHash,row.plan.premium);await f.worker.tick()
    const s=(await service.context(id,chain.account.address)).snapshot,amounts=amountsForLiquidity(s.liquidity,s.sqrtPrice,s.minTick,s.maxTick)
    for(const [i,token] of [s.token0,s.token1].entries())await chain.send(token.address,encodeFunctionData({abi,functionName:'approve',args:[s.adapter,[amounts.amount0,amounts.amount1][i]*101n/100n+1n]}))
    const data=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],[0n,0n,BigInt(s.headTimestamp+300)])
    await chain.send(s.vault,encodeFunctionData({abi,functionName:'deposit',args:[0n,0n,data]}))
    await chain.send(s.claimToken,encodeFunctionData({abi:parseAbi(['function transfer(address,uint256) returns(bool)']),functionName:'transfer',args:[f.account.address,1n]}))
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:/^My vaults/}).click()
    await page.getByRole('button',{name:'Sign in to view your vaults',exact:true}).click()
    await expect(page.getByRole('button',{name:'Claim premium',exact:true})).toBeVisible({timeout:20000})
    await page.getByRole('button',{name:'Claim premium',exact:true}).click()
    const dialog=page.getByRole('dialog')
    await expect(dialog.getByRole('button',{name:'Request retirement',exact:true})).toHaveCount(0)
    const claim=dialog.getByRole('button',{name:'Claim premium',exact:true})
    await expect(claim).toBeEnabled({timeout:20000});await claim.click()
    await expect(dialog.getByText('Position active',{exact:true})).toBeVisible({timeout:20000})
    expect(f.state.sends).toBe(1)
    expect((await database.getIntent(id)).wallet).toBe(chain.account.address.toLowerCase())
  }finally{await f.close()}
})

test('profile and administration can page to older vaults and retain that page on refresh',async({page})=>{
  const f=await setup(page,{admin:true})
  try{
    const {chain,database,account}=f
    const service=createIncentivesService({database,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,origin:f.origin})
    const template=await service.quote(account.address,'cashcat-3d','100'),offer=await database.offer('cashcat-3d')
    let oldest
    for(let i=0;i<26;i++){
      const quote=i===0?template:await database.putQuote({offer,principalCents:'10000',wallet:account.address,origin:f.origin,plan:{...template.plan,usdCheckedAt:Date.now()},signer:chain.account.address})
      const {id}=await database.acceptDeployment({wallet:account.address,quoteId:quote.id,signature:await account.signTypedData(deploymentTypedData(quote)),origin:f.origin})
      oldest??=id;await database.cancelDeployment(id,account.address)
    }
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:'My vaults',exact:true}).click()
    await page.getByRole('button',{name:'Sign in to view your vaults',exact:true}).click()
    await expect(page.locator('[data-deployment-id]')).toHaveCount(25)
    await expect(page.locator('[data-deployment-id="'+oldest+'"]')).toHaveCount(0)
    await page.getByRole('button',{name:'Older vaults',exact:true}).click()
    await expect(page.locator('[data-deployment-id="'+oldest+'"]')).toBeVisible()
    await expect(page.getByText('Page 2',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Refresh vaults',exact:true}).click()
    await expect(page.locator('[data-deployment-id="'+oldest+'"]')).toBeVisible()
    await expect(page.getByText('Page 2',{exact:true})).toBeVisible()
    await page.getByRole('button',{name:'View vault',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toHaveAttribute('data-vault-lifecycle',oldest)
    await page.getByRole('button',{name:'Close incentive vault'}).click()
    await page.getByRole('button',{name:'Administration',exact:true}).click()
    await expect(page.locator('[data-deployment-id]')).toHaveCount(25)
    await page.getByRole('button',{name:'Older vaults',exact:true}).click()
    await expect(page.locator('[data-deployment-id="'+oldest+'"]')).toBeVisible()
    await page.getByRole('button',{name:'Newer vaults',exact:true}).click()
    await expect(page.locator('[data-deployment-id]')).toHaveCount(25)
    await expect(page.getByText('Page 1',{exact:true})).toBeVisible()
  }finally{await f.close()}
})
