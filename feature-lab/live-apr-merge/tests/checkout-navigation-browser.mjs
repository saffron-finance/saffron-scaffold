import {chromium,expect as baseExpect} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdir,writeFile,readFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

/** Hold real API responses to prove navigation is independent of the network.
 * The external fixture owns a disposable DB/EVM and generated test wallet;
 * supply its checkout with SAFFRON_BACKEND_SOURCE, never a production server. */
const frontend=process.cwd(),source=process.env.SAFFRON_BACKEND_SOURCE
if(!source)throw new Error('Set SAFFRON_BACKEND_SOURCE to the isolated backend fixture checkout.')
const backend=resolve(source),dist=resolve(frontend,process.env.MERGE_DIST||'dist-live')
const evidence=resolve(frontend,process.env.MERGE_EVIDENCE||'validation/checkout-navigation')
const marker=JSON.parse(await readFile(resolve(dist,'deployment-mode.json'),'utf8'))
const {setup,connect}=await import(pathToFileURL(resolve(backend,'tests/browser/fixture.mjs')).href)
process.env.DIST_DIR=dist;process.chdir(backend);await mkdir(evidence,{recursive:true})
const expect=baseExpect.configure({timeout:20000}),browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:390,height:1000}}),errors=[],checks=[],quotes=[]
page.on('pageerror',e=>errors.push(e.message))
const quotePattern='**/api/incentives/deployment-quotes',withdrawPattern=quotePattern+'/withdraw'
page.on('request',r=>{if(r.url().endsWith('/deployment-quotes'))quotes.push(r.postDataJSON().amountUsd)})
const amount=()=>page.getByLabel('Deposit value in US dollars')
const next=()=>page.getByRole('button',{name:'Continue',exact:true})
const back=()=>page.getByRole('button',{name:'← Back',exact:true})
const saved=()=>page.evaluate(()=>JSON.parse(localStorage.getItem(Object.keys(localStorage).find(k=>k.startsWith('saffron.creation-payments.v1:')))||'null'))
let f,heartbeat,release,finished
/** Hold one response after the server has handled it, including a simulated
 * lost reply. This exercises idempotent recovery as well as slow responses. */
async function hold(pattern,fail=false){
 let finish;finished=new Promise(r=>{finish=r})
 await page.route(pattern,async route=>{
  try{
   const response=await route.fetch()
   await new Promise(r=>{release=r})
   if(fail)await route.fulfill({status:503,json:{error:'Test cleanup response unavailable'}})
   else await route.fulfill({response})
  }finally{finish()}
 })
}
async function unblock(pattern){
 await expect.poll(()=>Boolean(release)).toBe(true)
 release();release=null;await finished;await page.unroute(pattern)
}
/** Measure the first animation frame after a real React click. No API response
 * is released until after the amount form is visible, focused and editable. */
async function immediateBack(label){
 const result=await back().evaluate(button=>new Promise(resolve=>{
  const started=performance.now();button.click()
  requestAnimationFrame(()=>{
   const field=document.querySelector('[aria-label="Deposit value in US dollars"]')
   resolve({ms:performance.now()-started,visible:Boolean(field&&field.getBoundingClientRect().height),focused:document.activeElement===field})
  })
 }))
 assert(result.visible&&result.focused,JSON.stringify({label,...result}))
 await expect(next()).toBeEnabled();await expect(next()).not.toHaveAttribute('aria-disabled','true')
 checks.push({label,...result})
}
try{
 f=await setup(page,{campaign:true,basePath:marker.basePath.replace(/\/$/,'')})
 await f.database.execution.heartbeat(f.chain.account.address)
 heartbeat=setInterval(()=>void f.database.execution.heartbeat(f.chain.account.address).catch(()=>{}),5000)
 await page.goto(f.origin+'/');await connect(page)
 await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
 await next().click();await expect(page.getByRole('button',{name:'$100.00',exact:true})).toBeVisible()

 // Prepared review -> Back -> Continue -> Back -> Continue while cancellation
 // is blocked. Only the final edited amount may create a replacement quote.
 await hold(withdrawPattern);await immediateBack('prepared quote, blocked withdrawal')
 await amount().fill('200');await next().click();await expect(page.getByRole('heading',{name:'Claim $2.00',exact:true})).toBeVisible()
 await immediateBack('queued quote, previous withdrawal still blocked')
 await amount().fill('300');await next().click();await expect(page.getByRole('heading',{name:'Claim $3.00',exact:true})).toBeVisible()
 assert.deepEqual(quotes,['100']);assert.equal(f.state.sends,0)
 await unblock(withdrawPattern);await expect(page.getByRole('button',{name:'$300.00',exact:true})).toBeVisible()
 assert.deepEqual(quotes,['100','300'])

 // A late quote response must be saved for withdrawal, never rendered over the
 // newer preview. Claim alone may wait; neither Back nor Continue may wait.
 await immediateBack('desktop return');await expect.poll(async()=>(await saved())?.activeId??null).toBe(null)
 await page.setViewportSize({width:1440,height:1000})
 await hold(quotePattern);await amount().fill('400');await next().click()
 await expect.poll(()=>Boolean(release)).toBe(true)
 await immediateBack('quote preparation response blocked')
 await amount().fill('500');await next().click()
 await page.getByRole('button',{name:'Claim $5.00',exact:true}).click()
 await expect(page.getByText('Making request...', {exact:true})).toBeVisible();assert.equal(f.state.sends,0)
 // Closing cancels this Claim's permission to open a wallet after cleanup.
 await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
 await expect(page.locator('[data-incentive-modal]')).toHaveCount(0)
 const cancelledQuoteCleanup=page.waitForResponse(response=>response.url().endsWith('/deployment-quotes/withdraw')&&response.ok(),{timeout:20000})
 await unblock(quotePattern);await cancelledQuoteCleanup
 await expect.poll(async()=>(await saved())?.activeId??null).toBe(null)
 // Dismissal now revokes preparation too: the queued $500 quote must not be
 // created after the owner closes. A fresh explicit Continue may recreate it.
 assert.equal(f.state.sends,0);assert.deepEqual(quotes,['100','300','400'])

 // A lost cancellation response must not delete recovery or kick the user
 // back. The next explicit Continue retries idempotently before a new quote.
 await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
 await expect(amount()).toBeVisible();await amount().fill('500');await next().click()
 await expect(page.getByRole('button',{name:'$500.00',exact:true})).toBeVisible()
 await hold(withdrawPattern,true);await immediateBack('lost withdrawal response')
 await unblock(withdrawPattern);await expect(page.getByRole('alert')).toContainText('Test cleanup response unavailable')
 assert((await saved()).activeId);await expect(amount()).toBeVisible()
 await amount().fill('600');await next().click()
 await expect(page.getByRole('button',{name:'$600.00',exact:true})).toBeVisible()
 assert.deepEqual(quotes,['100','300','400','500','600'])
 const ledger=await saved();assert.equal(Object.values(ledger.records).filter(p=>p.status!=='abandoned').length,1)
 await page.screenshot({path:resolve(evidence,'review-after-back.png')})

 // Finish exactly one explicit fixture-only payment after repeated edits.
 await page.getByRole('button',{name:'Claim $6.00',exact:true}).click()
 await expect(page.locator('[data-deployment-waiting]')).toBeVisible()
 await expect(back()).toHaveCount(0);assert.equal(f.state.sends,1)
 assert.deepEqual(errors,[])
 const report={ok:true,checks,quotes,closeCancelsWallet:true,failedCleanupRecoverable:true,fixturePayments:1,productionPayments:0,errors}
 await writeFile(resolve(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(error){await page.screenshot({path:resolve(evidence,'failure.png')});throw error}
finally{if(release){release();await finished}clearInterval(heartbeat);await browser.close();await f?.close()}
