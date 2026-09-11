import { test,expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'
import { encodeAbiParameters,encodeFunctionData,parseAbi } from 'viem'
import { createIncentivesService } from '../../server/incentives-service.mjs'
import { mockPayment } from '../incentives-fixture.mjs'
import { proofHash } from '../../shared/payment.mjs'
import { abi } from '../../shared/vault-lifecycle.mjs'
import { amountsForLiquidity } from '../../shared/liquidity-math.mjs'
import { runOneRequest } from '../../worker/one-shot.mjs'
import { simulateFactory } from '../../worker/fork-simulate.mjs'
import { privateFilesFixture } from '../private-files-fixture.mjs'
import { mkdir,writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'

test('production runtime: complete paid campaign cycle with watcher recovery, reviewed creation and external treasury',async({page})=>{
  const f=await setup(page,{wrap:true,campaign:true}),files=await privateFilesFixture('saffron-browser-cycle-')
  try{
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
    await page.getByLabel('Deposit value in US dollars').fill('100')
    await page.getByRole('button',{name:'Continue',exact:true}).click()
    await expect(page.getByRole('heading',{name:'Review deployment'})).toBeVisible()
    expect(f.state.sends).toBe(0)
    await expect(page.getByText('Pay request fee with',{exact:true})).toHaveCount(0)
    // Lose the acceptance callback entirely. Only the keyless watcher can admit.
    await page.route('**/api/incentives/deployments',async route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Payment callback unavailable'}}):route.continue())
    await page.route('**/api/incentives/payments/recover',route=>route.fulfill({json:{state:'discovering'}}))
    await page.getByRole('button',{name:'Pay $2 in ETH',exact:true}).click()
    await expect(page.getByText('Payment callback unavailable',{exact:true})).toBeVisible()
    await page.reload();await page.getByRole('button',{name:'Resume deployment',exact:true}).click()
    await page.unroute('**/api/incentives/payments/recover')
    await expect(page.locator('[data-vault-lifecycle]')).toBeVisible({timeout:20000})
    const id=await page.locator('[data-vault-lifecycle]').getAttribute('data-vault-lifecycle')
    expect((await f.database.list({wallet:f.account.address})).jobs).toHaveLength(1)
    expect(await f.database.execution.workerOnline(f.chain.account.address)).toBe(false)
    const job=await f.database.getIntent(id),simulation=await simulateFactory({upstream:f.chain.raw,config:f.chain.config,job})
    expect(simulation.upstreamBroadcasts).toBe(0);expect(simulation.transactions).toHaveLength(3)
    f.chain.beforeBroadcast=async()=>{
      const journal=await f.database.execution.transactions(id)
      if(journal.length>1){await page.getByRole('button',{name:'Check progress',exact:true}).click();await expect(page.getByRole('list',{name:'Vault creation progress'}).getByText('Complete',{exact:true})).toHaveCount(journal.length-1)}
    }
    expect((await runOneRequest({database:f.database,rpc:f.chain.rpc,account:f.chain.account,config:f.chain.config,requestId:id,simulation,directory:files.directory,pollMs:5})).state).toBe('created')
    f.chain.beforeBroadcast=undefined
    await expect(page.getByRole('status',{name:''}).filter({hasText:'Awaiting campaign funding'})).toBeVisible({timeout:20000})
    const progress=page.getByRole('list',{name:'Vault creation progress'})
    await expect(progress.getByRole('listitem')).toHaveCount(4)
    await expect(progress.getByText('Complete',{exact:true})).toHaveCount(3)
    const elapsed=await page.getByLabel('Time since request').textContent()
    await expect(page.getByLabel('Time since request')).not.toHaveText(elapsed)
    await page.route('**/api/incentives/deployments/'+id+'?*',route=>route.fulfill({status:503,json:{error:'Status temporarily unavailable'}}))
    await page.getByRole('button',{name:'Check progress',exact:true}).click()
    await expect(page.getByText('Verification temporarily unavailable',{exact:true})).toBeVisible()
    await expect(progress.getByText('Complete',{exact:true})).toHaveCount(3)
    await expect(page.getByRole('button',{name:'Deposit LP assets',exact:true})).toHaveCount(0)
    await page.emulateMedia({reducedMotion:'reduce'})
    await page.setViewportSize({width:390,height:844})
    expect(await page.getByRole('dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
    await page.screenshot({path:'validation/waiting-mobile.png',fullPage:true,animations:'disabled'})
    await page.unroute('**/api/incentives/deployments/'+id+'?*')
    await page.getByRole('button',{name:'Check progress',exact:true}).click()
    await expect(page.getByText('Awaiting campaign funding',{exact:true})).toBeVisible()
    await expect(page.getByRole('button',{name:'Deposit',exact:true})).toHaveCount(0)
    const row=await f.database.getIntent(id)
    expect(f.treasuryAddress.toLowerCase()).not.toBe(f.account.address.toLowerCase());expect(f.treasuryAddress.toLowerCase()).not.toBe(f.chain.account.address.toLowerCase())
    const partialFunding=await f.fund(row,BigInt(row.plan.premium)/2n)
    const partial=(await f.operatorCall('/admin/deployments/'+id+'/funding-brief')).brief
    expect(BigInt(partial.outstandingRaw)).toBeGreaterThan(0n)
    await page.getByRole('button',{name:'Check progress',exact:true}).click()
    await expect(page.getByRole('button',{name:'Deposit LP assets',exact:true})).toHaveCount(0)
    const finalFunding=await f.fund(row)
    await expect(page.getByRole('button',{name:'Deposit LP assets',exact:true})).toBeEnabled({timeout:20000})
    await expect(page.getByRole('button',{name:'Wrap ETH',exact:true})).toHaveCount(0)
    await page.getByRole('button',{name:'Close incentive vault'}).click()
    await page.getByRole('button',{name:/^My requests/}).click()
    await expect(page.getByRole('button',{name:'Deposit',exact:true})).toBeVisible({timeout:20000})
    await page.getByRole('button',{name:'Deposit',exact:true}).click()
    await expect(page.locator('[data-vault-lifecycle]')).toHaveAttribute('data-vault-lifecycle',id)
    for(const name of ['Wrap ETH','Approve CASHCAT','Approve ETH','Deposit']){
      const button=page.getByRole('dialog').getByRole('button',{name,exact:true});await expect(button).toBeEnabled({timeout:20000});await button.click()
    }
    await expect(page.getByRole('dialog').getByRole('button',{name:'Claim premium',exact:true})).toBeEnabled({timeout:20000})
    const balance=token=>f.chain.client.readContract({address:token,abi,functionName:'balanceOf',args:[f.account.address]})
    const deposited=await Promise.all([row.plan.token0.address,row.plan.token1.address].map(balance))
    await page.getByRole('dialog').getByRole('button',{name:'Claim premium',exact:true}).click()
    await expect(page.getByRole('dialog').getByText('Position active',{exact:true})).toBeVisible({timeout:20000})
    const snapshot=await f.database.execution.observation(id)
    expect(BigInt(snapshot.endTime)-BigInt(snapshot.startTime)).toBe(BigInt(row.snapshot.durationSeconds))
    await expect(page.getByLabel('Vault start time',{exact:true})).toHaveAttribute('datetime',new Date(Number(snapshot.startTime)*1000).toISOString())
    await expect(page.getByLabel('Vault maturity time',{exact:true})).toHaveAttribute('datetime',new Date(Number(snapshot.endTime)*1000).toISOString())
    await f.advanceTo(Number(snapshot.endTime)+2)
    await expect(page.getByRole('dialog').getByRole('button',{name:'Withdraw LP assets',exact:true})).toBeEnabled({timeout:20000})
    await page.getByRole('dialog').getByRole('button',{name:'Withdraw LP assets',exact:true}).click()
    await expect(page.getByRole('dialog').getByText('Completed',{exact:true})).toBeVisible({timeout:20000})
    expect((await f.database.catalog(true)).budgets[0].allocatedRaw).toBe(row.plan.premium)
    const final=await f.database.execution.observation(id),returned=await Promise.all([row.plan.token0.address,row.plan.token1.address].map(balance))
    expect(final.claimBalance).toBe('0');expect(final.fixedBalance).toBe('0')
    expect(returned[0]).toBeGreaterThan(deposited[0]);expect(returned[1]).toBeGreaterThan(deposited[1])
    const variableOwner=await f.chain.client.readContract({address:final.variableBearerToken,abi,functionName:'balanceOf',args:[f.treasuryAddress]})
    expect(variableOwner.toString()).toBe(row.plan.premium)
    const budget=(await f.database.catalog(true)).budgets[0]
    expect(budget.accounting.fundedBudgetCents).toBe('100');expect(budget.accounting.availableBudgetCents).toBe('99900')
    expect(budget.accounting.fixedDepositedCents).toBe('10000');expect(budget.accounting.availableCapacityCents).toBe('9990000')
    expect(budget.reservedRaw).toBe('0');expect(budget.heldRaw).toBe('0');expect((await f.database.auditBudget(budget.id)).valid).toBe(true)
    expect(f.state.calls).not.toContain('eth_sendRawTransaction')
    expect(f.state.sends).toBe(7)
    expect(f.state.signs).toBe(0)
    expect(f.chain.broadcasts).toBe(3)
    const transactions=(await f.database.execution.transactionMetadata(id)).map(t=>({step:t.step,hash:t.resolved_hash??t.hash,blockNumber:t.receipt.blockNumber,blockHash:t.receipt.blockHash}))
    const payment=(await f.database.query('SELECT hash FROM saffron_incentives.payment_proofs')).rows[0]
    const finalView=(await (await fetch(f.origin+'/api/incentives/deployments/'+id+'?wallet='+f.account.address)).json()).deployment
    expect(finalView.state).toBe('completed');expect(finalView.canClaim).toBe(false);expect(finalView.canWithdraw).toBe(false)
    const userTransactions=(await f.database.query('SELECT hash,action,canonical FROM saffron_incentives.user_operations WHERE intent_id=$1 ORDER BY created_at',[id])).rows
    await mkdir('validation',{recursive:true})
    await writeFile('validation/complete-cycle.json',JSON.stringify({codeCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',windowsHide:true}).trim(),fixture:'evmFixture with real Uniswap position manager and generated accounts',chainId:4663,live:false,
      requester:f.account.address,creator:f.chain.account.address,treasury:f.treasuryAddress,requestId:id,planHash:row.plan_hash,paymentHash:payment.hash,
      protocol:{factoryCodeHash:f.chain.config.factoryCodeHash,vaultTypeHash:f.chain.config.vaultTypeHash,adapterTypeHash:f.chain.config.adapterTypeHash},
      simulation:{ok:simulation.ok,upstreamBroadcasts:simulation.upstreamBroadcasts},creation:transactions,funding:[...partialFunding,...finalFunding],userTransactions,
      final:{positionState:finalView.state,requestState:(await f.database.getIntent(id)).status,blockNumber:final.blockNumber,blockHash:final.blockHash,startTime:(BigInt(final.endTime)-BigInt(final.duration)).toString(),endTime:final.endTime,claimBalance:final.claimBalance,fixedBalance:final.fixedBalance,treasuryBearerRaw:variableOwner.toString(),tokenBalances:returned.map(String)},
      ledger:{premiumRaw:row.plan.premium,reservedRaw:budget.reservedRaw,heldRaw:budget.heldRaw,allocatedRaw:budget.allocatedRaw,...budget.accounting},userMessageSignatures:f.state.signs,userTransactionsSent:f.state.sends},null,2)+'\n')
    await page.screenshot({path:'validation/completed-lifecycle.png',fullPage:true})
  }finally{await f.close();await files.close()}
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
    await offers.first().hover();await expect(offers.first()).toHaveCSS('border-top-color','rgb(255, 188, 9)')
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
    await expect(page.locator('a[href*="beta.saffron.finance"]')).toHaveCount(4)
    await expect(page.getByRole('link',{name:'Variable yield',exact:true})).toHaveAttribute('href',/view=variable$/)
  }finally{await f.close()}
})

test('a received claim appears in the holder profile and uses the native claim modal',async({page})=>{
  const f=await setup(page)
  try{
    const {chain,database}=f
    const service=createIncentivesService({database,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:f.origin})
    const {id}=await chain.accept(service)
    await f.worker.tick()
    const row=await service.detail(id,chain.account.address)
    await chain.fund(row)
    const s=(await service.context(id,chain.account.address)).snapshot,amounts=amountsForLiquidity(s.liquidity,s.sqrtPrice,s.minTick,s.maxTick)
    for(const [i,token] of [s.token0,s.token1].entries())await chain.send(token.address,encodeFunctionData({abi,functionName:'approve',args:[s.adapter,[amounts.amount0,amounts.amount1][i]*101n/100n+1n]}))
    const data=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],[0n,0n,BigInt(s.headTimestamp+300)])
    await chain.send(s.vault,encodeFunctionData({abi,functionName:'deposit',args:[0n,0n,data]}))
    await chain.send(s.claimToken,encodeFunctionData({abi:parseAbi(['function transfer(address,uint256) returns(bool)']),functionName:'transfer',args:[f.account.address,1n]}))
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:/^My requests/}).click()
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
    const service=createIncentivesService({database,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:f.origin})
    const template=await service.quote(account.address,'cashcat-3d','100',proofHash(chain.recoverySecret)),offer=await database.offer('cashcat-3d')
    let oldest
    for(let i=0;i<26;i++){
      const quote=i===0?template:await database.putQuote({offer,principalCents:'10000',wallet:account.address,origin:f.origin,plan:{...template.plan,usdCheckedAt:Date.now()},signer:chain.account.address})
      const {id}=await database.acceptDeployment({wallet:account.address,quoteId:quote.id,payment:mockPayment(quote),origin:f.origin})
      oldest??=id;await database.cancelDeployment(id,account.address)
    }
    await page.goto(f.origin);await connect(page)
    await page.getByRole('button',{name:'My requests',exact:true}).click()
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
    await page.goto(f.origin+'/admin')
    await page.getByRole('button',{name:'Sign in as operator',exact:true}).click()
    await expect(page.locator('[data-deployment-id]')).toHaveCount(25)
    await page.getByRole('button',{name:'Older vaults',exact:true}).click()
    await expect(page.locator('[data-deployment-id="'+oldest+'"]')).toBeVisible()
    await page.getByRole('button',{name:'Newer vaults',exact:true}).click()
    await expect(page.locator('[data-deployment-id]')).toHaveCount(25)
    await expect(page.getByText('Page 1',{exact:true})).toBeVisible()
  }finally{await f.close()}
})
