import {chromium,expect as baseExpect} from '@playwright/test'
import assert from 'node:assert/strict'
import {mkdir,readFile,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import {pathToFileURL} from 'node:url'

/** Exercise the compiled intake editor against real revision checks in a
 * disposable database/API. Nondefault watcher IDs are fixture values, not a
 * statement about any production watcher. No quote or transaction is created. */
const frontend=process.cwd(),source=process.env.SAFFRON_BACKEND_SOURCE
if(!source)throw new Error('Set SAFFRON_BACKEND_SOURCE to an isolated backend fixture checkout.')
const backend=resolve(source),dist=resolve(frontend,process.env.MERGE_DIST||'dist-live')
const evidence=resolve(frontend,process.env.MERGE_EVIDENCE||'validation/intake-policy')
const marker=JSON.parse(await readFile(resolve(dist,'deployment-mode.json'),'utf8'))
const {setup,connect}=await import(pathToFileURL(resolve(backend,'tests/browser/fixture.mjs')).href)
process.env.DIST_DIR=dist;process.chdir(backend);await mkdir(evidence,{recursive:true})
const expect=baseExpect.configure({timeout:20000}),browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[],posts=[],responses=[],observations=[]
page.on('pageerror',error=>errors.push(error.message))
page.on('request',request=>{if(request.method()==='POST'&&request.url().endsWith('/admin/intake'))posts.push(request.postDataJSON())})
page.on('response',async response=>{if(response.ok()&&/\/admin\/(health|status)$/.test(response.url())){const json=await response.json();observations.push({path:new URL(response.url()).pathname,signer:json.signer,policy:json.readiness?.policy})}if(response.request().method()==='POST'&&response.url().endsWith('/admin/intake'))responses.push(response.status())})
let f
try{
  f=await setup(page,{admin:true,basePath:marker.basePath.replace(/\/$/,'')})
  const current=()=>f.database.intakePolicy(f.chain.account.address)
  async function otherSession(patch){
    const p=await current()
    return f.operatorCall('/admin/intake',{signer:p.signer,revision:p.revision,mode:p.mode,enabled:p.enabled,
      expiresAt:new Date(Date.now()+37*60000).toISOString(),serviceMinutes:p.service_minutes,watcherId:p.watcher_id,...patch})
  }
  await otherSession({mode:'reviewed',enabled:false,serviceMinutes:725,watcherId:'fixture-saved-watcher'})
  await page.goto(f.origin+'/admin');await connect(page)
  await page.getByRole('button',{name:'Sign in as operator',exact:true}).click()
  const form=page.locator('#intake-controls')
  await form.locator('summary').click()
  const mode=form.getByLabel('Execution mode'),watcher=form.getByLabel('Payment watcher ID'),service=form.getByLabel('Declared service window (minutes)')
  const open=form.getByRole('button',{name:'Open intake window',exact:true}),pause=form.getByRole('button',{name:'Pause new requests',exact:true})
  const load=form.getByRole('button',{name:'Load latest settings',exact:true})
  await expect(mode).toHaveValue('reviewed');await expect(watcher).toHaveValue('fixture-saved-watcher');await expect(service).toHaveValue('725')
  const original=await current();await open.click()
  await expect.poll(async()=>(await current()).revision).toBe(original.revision+1)
  await expect(open).toBeEnabled()
  assert.equal(posts[0].watcherId,'fixture-saved-watcher');assert.equal(posts[0].serviceMinutes,725)
  assert.equal(posts[0].revision,original.revision)

  // A second authenticated session changes execution mode while this operator
  // has an untouched old mode and a local service-duration edit.
  await service.fill('333')
  const newer=(await otherSession({mode:'automatic',watcherId:'fixture-current-watcher',serviceMinutes:900})).policy
  await page.getByRole('button',{name:'Refresh operations',exact:true}).click()
  await expect(form.getByRole('alert')).toContainText('Intake policy changed elsewhere')
  await expect(mode).toHaveValue('reviewed');await expect(service).toHaveValue('333')
  await expect(open).toBeDisabled();await expect(pause).toBeDisabled();assert.equal(posts.length,1)
  await load.click()
  await expect(mode).toHaveValue('automatic');await expect(watcher).toHaveValue('fixture-current-watcher');await expect(service).toHaveValue('900')
  await open.click();await expect.poll(()=>posts.length).toBe(2)
  assert.equal(posts[1].revision,newer.revision);assert.equal(posts[1].mode,'automatic')
  await expect(open).toBeEnabled()

  // Freeze the health poll to model a concurrent edit that this form has not
  // observed. The real POST must use its old revision and get an actual 409.
  const frozen=await (await page.request.get(f.origin+'/api/incentives/admin/health')).json()
  await page.route('**/api/incentives/admin/health',route=>route.fulfill({json:frozen}))
  const race=(await otherSession({mode:'reviewed',serviceMinutes:610})).policy
  await open.click()
  await expect(form.getByRole('alert')).toContainText('Intake policy changed elsewhere')
  await expect.poll(()=>responses.at(-1)).toBe(409)
  assert.equal(posts.at(-1).revision,race.revision-1)
  assert.equal((await current()).mode,'reviewed');assert.equal((await current()).service_minutes,610)
  await expect(open).toBeDisabled()

  await page.setViewportSize({width:390,height:844})
  await page.screenshot({path:resolve(evidence,'mobile-conflict.png'),fullPage:true})
  assert(await form.evaluate(node=>node.scrollWidth<=node.clientWidth),'mobile intake editor overflow')
  await load.click();await expect(mode).toHaveValue('reviewed');await expect(service).toHaveValue('610')
  await page.unroute('**/api/incentives/admin/health')
  // Pausing is not permission to apply unsaved watcher/mode/service edits.
  await watcher.fill('unsaved-draft');await mode.selectOption('automatic');await service.fill('111')
  await pause.click();await expect.poll(async()=>(await current()).enabled).toBe(false)
  const final=await current()
  assert.equal(final.watcher_id,'fixture-current-watcher');assert.equal(final.service_minutes,610);assert.equal(final.mode,'reviewed')
  assert.equal(f.state.sends,0)
  assert.equal((await f.database.query('SELECT count(*)::int count FROM saffron_incentives.deployment_quotes')).rows[0].count,0)
  assert.deepEqual(errors,[])
  const report={ok:true,savedNondefaultsPreserved:true,polledConflictNoWrite:true,unseenRaceStatus:409,
    explicitReloadRequired:true,pausePreservesSavedPolicy:true,desktop:true,mobile:true,walletTransactions:0,quotes:0,errors}
  await writeFile(resolve(evidence,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(error){await writeFile(resolve(evidence,'failure-policies.json'),JSON.stringify({posts,responses,observations:observations.slice(-8)},null,2));await page.screenshot({path:resolve(evidence,'failure.png'),fullPage:true});throw error}
finally{await browser.close();await f?.close()}
