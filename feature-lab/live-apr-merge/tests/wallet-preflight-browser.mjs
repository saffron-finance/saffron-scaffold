import {chromium,expect as baseExpect} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

/** Real browser/React/Web Locks + disposable backend/EVM. Stall the selected
 * provider before it requests a signature; never connect to a production wallet.
 * The separately supplied fixture owns its test database and generated keys. */
const frontend=process.cwd(),source=process.env.SAFFRON_BACKEND_SOURCE
if(!source)throw new Error('Set SAFFRON_BACKEND_SOURCE to an isolated backend fixture checkout.')
const backend=resolve(source),dist=resolve(frontend,process.env.MERGE_DIST||'dist-live')
const evidence=resolve(frontend,process.env.MERGE_EVIDENCE||'validation/wallet-preflight')
const marker=JSON.parse(await readFile(resolve(dist,'deployment-mode.json'),'utf8'))
const moduleAt=p=>import(pathToFileURL(resolve(backend,p)).href)
const {setup}=await moduleAt('tests/browser/fixture.mjs')
const {createIncentivesService}=await moduleAt('server/incentives-service.mjs')
process.env.DIST_DIR=dist;process.chdir(backend);await mkdir(evidence,{recursive:true})
const expect=baseExpect.configure({timeout:25000}),browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[]
page.on('pageerror',e=>errors.push(e.message))
let f,heartbeat
const lockCount=()=>page.evaluate(async()=>(await navigator.locks.query()).held.filter(l=>l.name.startsWith('saffron.wallet-action:')).length)
try{
  f=await setup(page,{admin:true,basePath:marker.basePath.replace(/\/$/,'')})
  await f.database.execution.heartbeat(f.chain.account.address)
  heartbeat=setInterval(()=>void f.database.execution.heartbeat(f.chain.account.address).catch(()=>{}),5000)
  const service=createIncentivesService({database:f.database,rpc:f.chain.rpc,config:f.chain.config,signer:f.chain.account.address,
    origin:new URL(f.origin).origin,feeRecipient:f.chain.feeRecipient,usdQuote:f.chain.usdQuote})
  const accepted=await f.chain.accept(service),id=accepted.id
  assert.equal((await f.worker.tick()).state,'created')
  await page.goto(f.origin+'/admin')
  await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click()
  await page.getByRole('button',{name:'MetaMask',exact:true}).click()
  await page.getByRole('button',{name:'Sign in as operator',exact:true}).click()
  await page.getByRole('button',{name:'Requests',exact:true}).click()
  await page.locator('summary').filter({hasText:id.slice(0,8)}).click()
  const card=page.locator('[data-deployment-id="'+id+'"]')
  const open=()=>card.getByRole('button',{name:'Awaiting incentive program funding',exact:true}).click()
  const modal=page.getByRole('dialog',{name:'Fund incentive program',exact:true})
  const close=()=>modal.getByRole('button',{name:'Close incentive program funding',exact:true})
  const approve=()=>modal.getByRole('button',{name:'Approve CASHCAT',exact:true})
  await page.evaluate(()=>{
    const original=window.ethereum.request.bind(window.ethereum)
    window.stalledReads=[];window.stallMethod='eth_estimateGas'
    window.ethereum.request=args=>args.method===window.stallMethod
      ?new Promise((resolve,reject)=>window.stalledReads.push(()=>original(args).then(resolve,reject)))
      :original(args)
  })
  await open();await approve().click()
  await expect.poll(()=>page.evaluate(()=>window.stalledReads.length)).toBe(1)
  await expect(close()).toBeEnabled();assert.equal(await lockCount(),1)
  await close().click();await expect(modal).toHaveCount(0)
  await expect.poll(lockCount).toBe(0);assert.equal(f.state.sends,0)
  // Late gas result after closing cannot send or re-lock the page.
  await page.evaluate(()=>{window.stallMethod='eth_getTransactionCount';window.stalledReads.splice(0).forEach(release=>release())})
  await page.setViewportSize({width:390,height:844})
  await open();await approve().click()
  await expect.poll(()=>page.evaluate(()=>window.stalledReads.length)).toBe(1)
  await expect(close()).toBeEnabled()
  await expect(modal.getByRole('alert')).toContainText('Wallet preparation timed out. No transaction was sent.')
  await expect(approve()).toBeEnabled();await expect.poll(lockCount).toBe(0)
  assert.equal(f.state.sends,0)
  const records=await page.evaluate(()=>Object.keys(localStorage).filter(k=>k.startsWith('saffron.campaign-funding.v1:')))
  assert.deepEqual(records,[])
  await page.screenshot({path:resolve(evidence,'mobile-timeout.png')})
  // Explicit retry alone may send. Use the same real wallet/controller to
  // approve and fund; confirmation and receipt recovery must still work.
  await page.evaluate(()=>{window.stallMethod=null;window.stalledReads.splice(0).forEach(release=>release())})
  await approve().click()
  const fund=modal.getByRole('button',{name:'Fund incentive program',exact:true})
  await expect(fund).toBeEnabled();assert.equal(f.state.sends,1)
  await fund.click();await expect(modal.getByRole('status')).toHaveText('Incentive program funding confirmed.')
  assert.equal(f.state.sends,2);await expect.poll(lockCount).toBe(0)
  await modal.getByRole('button',{name:'Done',exact:true}).click()

  // The user-position controller is nested inside the incentive dialog. Its
  // parent must also permit Close during a stalled preflight, not just admins.
  await page.goto(f.origin+'/')
  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:/^Claim \$/}).click()
  await expect(page.locator('[data-vault-lifecycle]')).toBeVisible()
  const userId=await page.locator('[data-vault-lifecycle]').getAttribute('data-vault-lifecycle')
  assert.equal((await f.worker.tick()).state,'created')
  await f.fund(await f.database.getIntent(userId))
  await expect(page.getByRole('button',{name:'Deposit LP assets',exact:true})).toBeEnabled()
  await page.getByRole('button',{name:'Deposit LP assets',exact:true}).click()
  await page.evaluate(()=>{
    const original=window.ethereum.request.bind(window.ethereum)
    window.stalledReads=[];window.stallMethod='eth_estimateGas'
    window.ethereum.request=args=>args.method===window.stallMethod
      ?new Promise((resolve,reject)=>window.stalledReads.push(()=>original(args).then(resolve,reject)))
      :original(args)
  })
  await page.getByRole('dialog').getByRole('button',{name:'Approve CASHCAT',exact:true}).click()
  await expect.poll(()=>page.evaluate(()=>window.stalledReads.length)).toBe(1)
  const userClose=page.getByRole('button',{name:'Close incentive vault',exact:true})
  await expect(userClose).toBeEnabled();await userClose.click()
  await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(lockCount).toBe(0)
  await page.evaluate(()=>{window.stallMethod=null;window.stalledReads.splice(0).forEach(release=>release())})
  assert.equal(f.state.sends,3,'only the prior funding and explicit request fee were sent')
  await page.goto(f.origin+'/portfolio/vaults')
  await page.locator('[data-deployment-id="'+userId+'"]').getByRole('button',{name:'Deposit',exact:true}).click()
  for(const name of ['Approve CASHCAT','Approve ETH','Deposit','Claim premium']){
    const action=page.getByRole('dialog').getByRole('button',{name,exact:true})
    await expect(action).toBeEnabled();await action.click()
  }
  await expect(page.getByRole('dialog').getByText('Position active',{exact:true})).toBeVisible()
  assert.equal(f.state.sends,7);await expect.poll(lockCount).toBe(0)
  assert.deepEqual(errors,[])
  const report={ok:true,desktopClose:true,mobileTimeout:true,userModalClose:true,lateResultsCannotSend:true,sharedLockReleased:true,
    realFixtureApprovalFundingDepositAndClaim:true,walletTransactions:7,productionTransactions:0,errors}
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(error){await page.screenshot({path:resolve(evidence,'failure.png')});throw error}
finally{clearInterval(heartbeat);await browser.close();await f?.close()}
