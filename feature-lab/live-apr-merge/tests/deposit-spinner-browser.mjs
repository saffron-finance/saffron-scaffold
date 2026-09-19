import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {once} from 'node:events'
import {chromium,expect} from '@playwright/test'

/** Real compiled modal + status hook; deterministic local-only props/API data.
 * No Anvil, provider, backend, credentials or real transactions participate. */
const directory=resolve('validation/deposit-spinner-preview'),output=resolve(process.env.MERGE_EVIDENCE||'validation/deposit-spinner-screenshots')
await mkdir(output,{recursive:true})
const server=createServer(async(req,res)=>{
 try{
  const path=resolve(directory,'.'+new URL(req.url,'http://fixture').pathname);assert(path===directory||path.startsWith(directory+sep))
  const file=extname(path)?path:resolve(directory,'index.html')
  res.setHeader('content-type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml','.png':'image/png','.jpg':'image/jpeg'}[extname(file)]||'application/octet-stream');res.end(await readFile(file))
 }catch{res.writeHead(404);res.end()}
})
server.listen(0,'127.0.0.1');await once(server,'listening')
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch(),page=await browser.newPage({viewport:{width:1440,height:1050}})
const errors=[],external=[],screenshots=[],layouts=[]
page.on('pageerror',error=>errors.push(error.message));page.on('request',request=>{if(!request.url().startsWith(origin)&&/^https?:/.test(request.url()))external.push(request.url())})
const modal=page.locator('[data-incentive-modal]'),spinner=modal.locator('[data-request-spinner]'),status=modal.getByRole('status')
const invoke=(method,...args)=>page.evaluate(([name,values])=>window.depositFixture[name](...values),[method,args])
/** Capture the rendered production modal, including its real title/close UI. */
async function capture(name,label){
 await expect(status).toHaveText(label);await expect(modal).toHaveCount(1);await expect(spinner).toHaveCount(1)
 await expect(modal.getByRole('list',{name:'Vault creation progress'})).toHaveCount(0)
 assert(await spinner.evaluate(node=>node.nextElementSibling.getAttribute('role')==='status'))
 await page.evaluate(()=>document.fonts.ready)
 await expect.poll(()=>modal.locator('img').evaluateAll(nodes=>nodes.length===2&&nodes.every(n=>n.complete&&n.naturalWidth>0))).toBe(true)
 await modal.screenshot({path:resolve(output,name+'.png')});screenshots.push({file:name+'.png',label})
}
async function begin(){await page.getByRole('button',{name:'Continue',exact:true}).click();await page.getByRole('button',{name:'Claim $8.21',exact:true}).click();await expect(status).toHaveText('Making request...')}
try{
 // Dismissal while preparation is outstanding cannot acquire permission for
 // a later payment. This uses the actual modal's async Claim cancellation.
 await page.goto(origin);await begin();await page.getByRole('button',{name:'Close incentive vault'}).click();await invoke('quoteReady');await expect(modal).toHaveCount(0);assert.equal((await invoke('stats')).payCalls,0)
 await page.reload();await begin();await capture('01-making-request','Making request...')
 await page.evaluate(()=>window.originalDepositDialog=document.querySelector('[data-incentive-modal]'))
 await invoke('quoteReady');await capture('02-confirming-payment','Confirming payment...');assert.equal((await invoke('stats')).payCalls,1)
 await invoke('accept')
 for(const [index,label] of ['Preparing your vault','Creating your vault','Checking your vault','Verifying vault'].entries()){
  await invoke('stage',index+1,index===3?'awaiting_funding':'creating');await capture('0'+(index+3)+'-'+label.toLowerCase().replaceAll(' ','-'),label)
  assert(await page.evaluate(()=>window.originalDepositDialog===document.querySelector('[data-incentive-modal]')))
  assert.equal(await spinner.evaluate(node=>getComputedStyle(node).borderTopColor),'rgb(210, 134, 255)')
 }
 await invoke('ready');await capture('07-ready-to-deposit','Your vault is ready');await expect(spinner).toHaveAttribute('data-spinning','false');await expect(modal.getByRole('button',{name:'Deposit LP assets'})).toBeEnabled()
 const details=modal.locator('[data-deployment-transactions]');await details.locator('summary').click();await expect(details.getByRole('link')).toHaveCount(1)
 const before=(await invoke('stats')).reads;await details.getByRole('button',{name:'Check progress'}).click();await expect.poll(async()=>(await invoke('stats')).reads).toBeGreaterThan(before)
 for(const width of [1440,768,390,320]){await page.setViewportSize({width,height:1050});assert(await modal.evaluate(node=>node.scrollWidth<=node.clientWidth));assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));layouts.push({width,expandedTransactions:true,noOverflow:true})}
 await details.locator('summary').click();await invoke('fail',true);await expect(modal.getByRole('button',{name:'Deposit LP assets'})).toBeDisabled();await expect(modal.getByRole('alert')).toContainText('new actions are paused')
 await capture('08-verification-unavailable-mobile','Verification temporarily unavailable')
 await page.emulateMedia({reducedMotion:'reduce'});assert.equal(await spinner.evaluate(node=>getComputedStyle(node).animationName),'none')
 await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await invoke('reopen');await expect(status).toHaveText('Verification temporarily unavailable');assert.equal((await invoke('stats')).payCalls,1)
 await invoke('fail',false);await expect(status).toHaveText('Your vault is ready');await expect(modal.getByRole('button',{name:'Deposit LP assets'})).toBeEnabled()
 assert.deepEqual(errors,[]);assert.deepEqual(external,[])
 const report={ok:true,mock:'Production React modal + real status polling hook; local deterministic props and HTTP responses',screenshots,layouts,singleDialog:true,singleSpinner:true,goldStagesRemoved:true,manualRefresh:true,closeCancelsPaymentPermission:true,closeAndResume:true,staleReadGate:true,reducedMotion:true,...await invoke('stats'),externalRequests:external.length,errors}
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error}
finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
