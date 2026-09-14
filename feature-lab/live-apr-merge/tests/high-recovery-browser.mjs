import {chromium,expect as baseExpect} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

/** Exercise the shipped React controller in two real tabs against disposable
 * PostgreSQL and EVM fixtures. Lost responses are actual mined test transactions,
 * not synthetic receipt objects. No production wallet or database is used. */
const frontend=process.cwd(),source=process.env.SAFFRON_BACKEND_SOURCE
if(!source)throw new Error('Set SAFFRON_BACKEND_SOURCE to an isolated backend fixture checkout.')
const backend=resolve(source),dist=resolve(frontend,process.env.MERGE_DIST||'dist-live')
const evidence=resolve(frontend,process.env.MERGE_EVIDENCE||'validation/high-recovery')
const marker=JSON.parse(await readFile(resolve(dist,'deployment-mode.json'),'utf8'))
const moduleAt=p=>import(pathToFileURL(resolve(backend,p)).href)
const {setup}=await moduleAt('tests/browser/fixture.mjs')
const {createIncentivesService}=await moduleAt('server/incentives-service.mjs')
process.env.DIST_DIR=dist;process.chdir(backend);await mkdir(evidence,{recursive:true})
const expect=baseExpect.configure({timeout:25000}),browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1000}})
const page=await context.newPage(),errors=[]
// The shared wallet fixture also runs on a new tab's opaque about:blank
// document, where crypto/storage are unavailable. Only app-document errors
// belong to this regression; errors on the actual test origin are never ignored.
context.on('page',p=>p.on('pageerror',e=>{if(p.url().startsWith('http://127.0.0.1:'))errors.push(e.message)}))
page.on('pageerror',e=>errors.push(e.message))
let f,heartbeat
const modal=p=>p.getByRole('dialog',{name:'Fund campaign',exact:true})
const storage=(p,key)=>p.evaluate(key=>localStorage.getItem(key),key)
const recovered=p=>modal(p).getByRole('button',{name:'Check funding transaction',exact:true})
const hashInput=p=>modal(p).getByLabel('Recover funding transaction hash')
try{
  f=await setup(page,{admin:true,basePath:marker.basePath.replace(/\/$/,'')})
  heartbeat=setInterval(()=>void f.database.execution.heartbeat(f.chain.account.address).catch(()=>{}),5000)
  const service=createIncentivesService({database:f.database,rpc:f.chain.rpc,config:f.chain.config,signer:f.chain.account.address,
    origin:new URL(f.origin).origin,feeRecipient:f.chain.feeRecipient,usdQuote:f.chain.usdQuote})
  const accepted=await f.chain.accept(service),id=accepted.id
  assert.equal((await f.worker.tick()).state,'created')
  const key='saffron.campaign-funding.v1:'+f.account.address.toLowerCase()+':'+id
  async function open(p,first=false){
    await p.goto(f.origin+'/admin')
    if(first){
      await p.getByRole('button',{name:'Connect wallet',exact:true}).first().click()
      await p.getByRole('button',{name:'MetaMask',exact:true}).click()
    }
    const sign=p.getByRole('button',{name:'Sign in as operator',exact:true})
    if(first)await sign.click()
    await p.getByRole('button',{name:'Requests',exact:true}).click()
    await p.locator('summary').filter({hasText:id.slice(0,8)}).click()
    await p.locator('[data-deployment-id="'+id+'"]').getByRole('button',{name:/^(Awaiting campaign funding|Recover funding transaction)$/}).click()
  }
  await open(page,true)
  // The first tab loses a real approval response; the other tab opens its
  // recovery review before the first tab advances to the next action.
  f.state.lostSend=true
  await modal(page).getByRole('button',{name:'Approve CASHCAT',exact:true}).click()
  await expect(hashInput(page)).toBeVisible()
  const oldRecord=JSON.parse(await storage(page,key)),oldHash=f.state.lastHash
  assert.equal(oldRecord.stage,'fund-approve');assert.equal(f.state.sends,1)
  const stale=await context.newPage();await stale.setViewportSize({width:390,height:844})
  // Model a suspended/old tab that missed notifications. The send/recovery
  // boundary must remain safe even when UI synchronization cannot help it.
  await stale.addInitScript(()=>window.addEventListener('storage',e=>e.stopImmediatePropagation(),true))
  await stale.route('**/api/incentives/admin/status',route=>route.abort())
  await open(stale);await expect(hashInput(stale)).toBeVisible()
  await hashInput(page).fill(oldHash);await recovered(page).click()
  await expect(modal(page).getByRole('button',{name:'Fund campaign',exact:true})).toBeEnabled()
  assert.equal(await storage(page,key),null)
  f.state.lostSend=true
  await modal(page).getByRole('button',{name:'Fund campaign',exact:true}).click()
  await expect(hashInput(page)).toBeVisible()
  const newRaw=await storage(page,key),newRecord=JSON.parse(newRaw),newHash=f.state.lastHash
  assert.equal(newRecord.stage,'fund');assert.notEqual(newRecord.actionId,oldRecord.actionId)
  await hashInput(stale).fill(oldHash);await recovered(stale).click()
  await expect(modal(stale).getByRole('alert')).toContainText('changed in another tab')
  assert.equal(await storage(page,key),newRaw);assert.equal(f.state.sends,2)
  await stale.screenshot({path:resolve(evidence,'mobile-stale-recovery.png')})

  // Recover the new transaction with real shared Web Locks. A concurrent tab
  // cannot enter recovery while this tab is waiting for the canonical receipt.
  let release,receiptRequested=false
  const held=new Promise(resolve=>{release=resolve})
  await page.route('**/rpc/robinhood',async route=>{
    const raw=route.request().postDataJSON(),requests=Array.isArray(raw)?raw:[raw]
    if(requests.some(r=>r.method==='eth_getTransactionReceipt')){receiptRequested=true;await held}
    await route.continue()
  })
  await hashInput(page).fill(newHash);await recovered(page).click()
  await expect.poll(()=>receiptRequested).toBe(true)
  await hashInput(stale).fill(newHash);await recovered(stale).click()
  await expect(modal(stale).getByRole('alert')).toContainText('Another Saffron wallet action is in progress')
  assert.equal(JSON.parse(await storage(page,key)).actionId,newRecord.actionId)
  release();await expect(modal(page).getByRole('status')).toHaveText('Campaign funding confirmed.')
  assert.equal(await storage(page,key),null);assert.equal(f.state.sends,2)
  await stale.close();await page.unroute('**/rpc/robinhood')

  // Obtain a real user-owned depositable vault; then fail session discovery and
  // payment history independently. Its primary list/context and wallet actions
  // must remain usable on both desktop and mobile.
  await modal(page).getByRole('button',{name:'Done',exact:true}).click()
  await page.goto(f.origin+'/')
  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:/^Claim \$/}).click()
  await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
  const userId=await page.locator('[data-vault-lifecycle]').getAttribute('data-vault-lifecycle')
  assert.equal((await f.worker.tick()).state,'created');await f.fund(await f.database.getIntent(userId))
  const failure=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Injected auxiliary outage'})})
  await page.route('**/api/incentives/session',failure)
  await page.route('**/api/incentives/payments?*',failure)
  for(const width of [1440,390]){
    await page.setViewportSize({width,height:900});await page.goto(f.origin+'/portfolio/vaults')
    const row=page.locator('[data-deployment-id="'+userId+'"]')
    await expect(row.getByRole('button',{name:'Deposit',exact:true})).toBeEnabled()
    await expect(page.getByText('Payment history is temporarily unavailable. Vault actions remain available.')).toBeVisible()
    await expect(page.getByText('Wallet sign-in status is unavailable. Vaults can still be viewed.')).toBeVisible()
    await expect(page.getByText('Showing the last known requests. Verification is temporarily unavailable.')).toHaveCount(0)
    await row.getByRole('button',{name:'Deposit',exact:true}).click()
    await expect(page.getByRole('dialog').getByRole('button',{name:'Approve CASHCAT',exact:true})).toBeEnabled()
    await page.screenshot({path:resolve(evidence,'auxiliary-outage-'+width+'.png')})
  }
  // Only an explicit user approval sends; failed auxiliary services are not a
  // new prerequisite. This is a fourth local-chain transaction, not mainnet.
  await page.getByRole('dialog').getByRole('button',{name:'Approve CASHCAT',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('button',{name:'Approve ETH',exact:true})).toBeEnabled()
  assert.equal(f.state.sends,4);assert.deepEqual(errors,[])
  const report={ok:true,staleTabCannotEraseOrOverwrite:true,realCrossTabLock:true,realLostResponseRecovery:true,
    auxiliaryOutagesPreserveVaultActions:true,desktop:true,mobile:true,walletTransactions:4,productionTransactions:0,errors}
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(error){await page.screenshot({path:resolve(evidence,'failure.png')});throw error}
finally{clearInterval(heartbeat);await browser.close();await f?.close()}
