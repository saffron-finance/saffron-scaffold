import { chromium, expect as baseExpect } from '@playwright/test'
import { mkdir, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Exercise this frontend against the canonical API, PostgreSQL and a disposable
 * local EVM. The backend fixture provides generated wallets, never live keys.
 * Run after build:live at base /. It does not use or reset the VNC browser. */
const expect=baseExpect.configure({timeout:20000})
const frontend=process.cwd(),source=process.env.SAFFRON_BACKEND_SOURCE
if(!source)throw new Error('Set SAFFRON_BACKEND_SOURCE to the liquidity-incentives package with its test dependencies installed.')
const device=process.env.MERGE_DEVICE??'mobile'
if(!['mobile','desktop'].includes(device))throw new Error('MERGE_DEVICE must be mobile or desktop.')
const backend=resolve(source),evidence=resolve(frontend,process.env.MERGE_EVIDENCE||'validation/backend-browser-'+device)
const backendCommit=execFileSync('git',['-C',backend,'rev-parse','HEAD'],{encoding:'utf8'}).trim()
const moduleAt=relative=>import(pathToFileURL(resolve(backend,relative)).href)
const {setup,connect}=await moduleAt('tests/browser/fixture.mjs')
const {simulateFactory}=await moduleAt('worker/fork-simulate.mjs')
process.env.DIST_DIR=resolve(frontend,'dist-live')
// The canonical fixture starts its actual server relative to the backend root.
process.chdir(backend)
await mkdir(evidence,{recursive:true})
const browser=await chromium.launch({headless:true})
// The approved mobile Home must connect a real injected-wallet boundary and
// submit to the canonical backend, not just pass browser-only preview tests.
const context=await browser.newContext(device==='mobile'?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{viewport:{width:1440,height:1000}})
const page=await context.newPage();page.setDefaultTimeout(20000)
const errors=[];page.on('pageerror',error=>errors.push(error.message))
let f,heartbeat
const report={ok:false,live:false,backendCommit,device,checks:[]}
try{
  f=await setup(page,{wrap:true,campaign:true})
  await f.database.execution.heartbeat(f.chain.account.address)
  await f.chain.prepareIntake(f.database,{mode:'automatic',continuous:true})
  heartbeat=setInterval(()=>void f.database.execution.heartbeat(f.chain.account.address).catch(()=>{}),5000)
  await page.goto(f.origin);await connect(page)
  await expect(page.locator('[data-incentive-offer]')).toHaveCount(1)
  await expect(page.getByText(/capacity remaining|near capacity|Sample request/i)).toHaveCount(0)
  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  if(device==='mobile'){
    for(const width of [320,390,430,599,600]){
      await page.setViewportSize({width,height:844})
      expect(await page.getByRole('dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
    }
    // Shortened viewport exercises the amount field and next action while a
    // keyboard occupies space; real phone keyboard qualification remains separate.
    await page.setViewportSize({width:390,height:420})
    await page.getByLabel('Deposit value in US dollars').fill('100')
    await page.getByRole('button',{name:'Continue',exact:true}).scrollIntoViewIfNeeded()
    await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeInViewport()
    await page.setViewportSize({width:390,height:844})
  }
  await page.getByLabel('Deposit value in US dollars').fill('100')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Claim $1.00',exact:true})).toBeVisible()
  expect(f.state.sends).toBe(0)
  // Lose the callback after fee submission. The actual independent watcher admits
  // its canonical on-chain payment; reload and recovery must not pay twice.
  await page.route('**/api/incentives/deployments',route=>route.request().method()==='POST'?route.fulfill({status:503,json:{error:'Payment callback unavailable'}}):route.continue())
  await page.route('**/api/incentives/payments/recover',route=>route.fulfill({json:{state:'discovering'}}))
  await page.getByRole('button',{name:'Claim $1.00',exact:true}).click()
  await expect(page.getByText('Payment callback unavailable',{exact:true})).toBeVisible()
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))
  expect(f.state.sends).toBe(1)
  await page.reload();await page.getByRole('button',{name:'Resume deployment',exact:true}).click()
  await expect.poll(async()=>(await f.database.list({wallet:f.account.address})).jobs.length,{timeout:20000}).toBe(1)
  // Start a second request from a reloaded recovery modal (no selected offer).
  // The first sent record must remain available in Portfolio, without a crash.
  await page.getByRole('button',{name:'Create another vault',exact:true}).click()
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await page.unroute('**/api/incentives/deployments')
  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  await page.getByLabel('Deposit value in US dollars').fill('200')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:'Claim $2.00',exact:true}).click()
  await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
  await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
  await page.getByRole('link',{name:'Portfolio',exact:true}).click()
  await page.getByRole('button',{name:'Check saved payment',exact:true}).click()
  await page.unroute('**/api/incentives/payments/recover')
  await page.getByRole('button',{name:'Check payment',exact:true}).click()
  await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
  const id=await page.locator('[data-vault-lifecycle]').getAttribute('data-vault-lifecycle')
  expect(f.state.sends).toBe(2);expect(f.state.signs).toBe(0)
  expect((await f.database.list({wallet:f.account.address})).jobs).toHaveLength(2)
  report.checks.push('Two independent fees, lost callback, watcher admission and reloaded payment recovery without a duplicate fee or message signatures')
  const job=await f.database.getIntent(id)
  const simulation=await simulateFactory({upstream:f.chain.raw,config:f.chain.config,job})
  expect(simulation.upstreamBroadcasts).toBe(0);expect(simulation.transactions).toHaveLength(3)
  expect((await f.database.intakePolicy(f.chain.account.address)).mode).toBe('automatic')
  expect((await f.worker.tick()).state).toBe('created')
  expect((await f.database.getIntent(id)).state).toBe('created')
  await page.getByRole('button',{name:'Check progress',exact:true}).click()
  await expect(page.getByText('Awaiting campaign funding',{exact:true})).toBeVisible()
  const progress=page.getByRole('list',{name:'Vault creation progress'})
  await expect(progress.getByRole('listitem')).toHaveCount(4)
  await expect(progress.getByText('Complete',{exact:true})).toHaveCount(3)
  await page.route('**/api/incentives/deployments/'+id+'?*',route=>route.fulfill({status:503,json:{error:'Status temporarily unavailable'}}))
  await page.getByRole('button',{name:'Check progress',exact:true}).click()
  await expect(page.getByText('Verification temporarily unavailable',{exact:true})).toBeVisible()
  await expect(progress.getByText('Complete',{exact:true})).toHaveCount(3)
  await expect(page.getByRole('button',{name:'Deposit LP assets',exact:true})).toHaveCount(0)
  expect(await page.getByRole('dialog').evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
  await page.screenshot({path:resolve(evidence,'c06-'+device+'.png'),fullPage:true})
  await page.unroute('**/api/incentives/deployments/'+id+'?*')
  await page.getByRole('button',{name:'Check progress',exact:true}).click()
  const row=await f.database.getIntent(id)
  await f.fund(row,BigInt(row.plan.premium)/2n)
  await page.getByRole('button',{name:'Check progress',exact:true}).click()
  await expect(page.getByRole('button',{name:'Deposit LP assets',exact:true})).toHaveCount(0)
  await f.fund(row)
  await expect(page.getByRole('button',{name:'Deposit LP assets',exact:true})).toBeEnabled()
  report.checks.push('Automatic queue creates without per-vault approval; read-only fork simulation, three creation transactions, C06, retained progress on API failure and partial-funding entry guard')
  await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
  await page.getByRole('link',{name:'Portfolio',exact:true}).click()
  await page.locator('[data-deployment-id="'+id+'"]').getByRole('button',{name:'Deposit',exact:true}).click()
  await expect(page.locator('[data-vault-lifecycle]')).toHaveAttribute('data-vault-lifecycle',id)
  for(const name of ['Wrap ETH','Approve CASHCAT','Approve ETH','Deposit','Claim premium']){
    const button=page.getByRole('dialog').getByRole('button',{name,exact:true});await expect(button).toBeEnabled();await button.click()
  }
  await expect(page.getByRole('dialog').getByText('Position active',{exact:true})).toBeVisible()
  const snapshot=await f.database.execution.observation(id)
  await expect(page.getByLabel('Vault start time',{exact:true})).toHaveAttribute('datetime',new Date(Number(snapshot.startTime)*1000).toISOString())
  await expect(page.getByLabel('Vault maturity time',{exact:true})).toHaveAttribute('datetime',new Date(Number(snapshot.endTime)*1000).toISOString())
  await f.advanceTo(Number(snapshot.endTime)+2)
  await page.getByRole('dialog').getByRole('button',{name:'Withdraw LP assets',exact:true}).click()
  await expect(page.getByRole('dialog').getByText('Completed',{exact:true})).toBeVisible()
  expect(f.state.sends).toBe(8);expect(f.state.signs).toBe(0);expect(f.chain.broadcasts).toBe(3)
  await expect(page.getByRole('button',{name:/retirement|refund request/i})).toHaveCount(0)
  report.checks.push('Merged Portfolio opens the owned position; wrap/approve/deposit/claim, start/maturity dates and withdrawal complete')
  const final=await f.database.execution.observation(id)
  report.requestId=id;report.chainId=4663;report.executionMode='automatic';report.viewport=page.viewportSize();report.simulation={ok:simulation.ok,upstreamBroadcasts:simulation.upstreamBroadcasts}
  report.final={claimBalance:final.claimBalance,fixedBalance:final.fixedBalance,blockNumber:final.blockNumber,blockHash:final.blockHash}
  expect(final.claimBalance).toBe('0');expect(final.fixedBalance).toBe('0');expect(errors).toEqual([])
  await page.screenshot({path:resolve(evidence,'completed.png'),fullPage:true})
  report.ok=true
}catch(error){report.failure=String(error);await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});throw error}
finally{
  await writeFile(resolve(evidence,'verification.json'),JSON.stringify({...report,errors},null,2)+'\n')
  clearInterval(heartbeat);await browser.close();if(f)await f.close()
  console.log(JSON.stringify(report));process.chdir(frontend)
}
