import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,writeFile,mkdir} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {once} from 'node:events'
import {chromium,expect} from '@playwright/test'

/** Exercise the final, unmodified application bundle via Portfolio. The only
 * simulated boundary is a loopback read-only API and a read-only wallet stub.
 * No Anvil process, transaction request or production service is touched. */
const dist=resolve(process.env.MERGE_DIST||'dist-live'),output=resolve(process.env.MERGE_EVIDENCE||'validation/deposit-spinner-runtime')
const marker=JSON.parse(await readFile(resolve(dist,'deployment-mode.json'),'utf8')),base=marker.basePath.replace(/\/$/,'')
const wallet='0x1111111111111111111111111111111111111111',token={address:'0x020bfc650a365f8bb26819deaabf3e21291018b4',symbol:'CASHCAT',decimals:18}
let row={id:'fixture-request',wallet,positionWallet:wallet,isRequester:true,programId:'fixture-program',state:'creating',depositable:false,canClaim:false,canWithdraw:false,canRecover:false,createdAt:new Date().toISOString(),transactions:[],snapshot:{display:{pair:'CASHCAT / USDG'},fixedCapacityAmount:'10000',durationSeconds:259200},plan:{token0:token,token1:{...token,address:'0x5fc5360d0400a0fd4f2af552add042d716f1d168',symbol:'USDG'},premiumCents:'821',premium:'8210000000000000000',variableDecimals:18,variableSymbol:'CASHCAT'},progress:{reason:'creating',activeStage:1,stages:[],requestedAt:new Date().toISOString(),lastProgressAt:new Date().toISOString()}}
let unavailable=false;const writes=[],unknown=[],errors=[],walletMethods=[],phases=[]
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://fixture').pathname
  const send=(body,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(body))}
  if(req.method!=='GET'){writes.push(req.method+' '+pathname);return send({error:'Writes forbidden'},405)}
  if(pathname.startsWith(base+'/api/incentives/')){
   const path=pathname.slice((base+'/api/incentives').length)
   if(path==='/session')return send({session:{wallet,operator:false,csrf:'fixture-only',expires:Date.now()+3600000}})
   if(path==='/programs')return send({offers:[],creatorOnline:false,readiness:{canQuote:false}})
   if(path==='/deployments')return send({deployments:[row],nextCursor:null})
   if(path==='/deployments/'+row.id)return unavailable?send({error:'Fixture verification unavailable'},503):send({deployment:row})
   if(path==='/positions')return send({positions:[]})
   if(path==='/payments')return send({payments:[],nextCursor:null})
   unknown.push(path);return send({error:'Unexpected fixture read'},404)
  }
  let path=resolve(dist,decodeURIComponent(pathname.slice(base.length)).replace(/^\//,''));assert(path===dist||path.startsWith(dist+sep));if(!extname(path))path=resolve(dist,'index.html')
  res.setHeader('content-type',{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'}[extname(path)]||'application/octet-stream');res.end(await readFile(path))
 }catch(error){res.writeHead(500);res.end('Fixture error');unknown.push(String(error))}
})
server.listen(0,'127.0.0.1');await once(server,'listening');await mkdir(output,{recursive:true})
const browser=await chromium.launch(),context=await browser.newContext({viewport:{width:1440,height:1050}}),page=await context.newPage()
page.on('pageerror',error=>errors.push(error.message))
await context.exposeFunction('depositReadWallet',async({method})=>{walletMethods.push(method);if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet];if(method==='eth_chainId')return '0x1237';throw Error('Unexpected wallet method: '+method)})
await context.addInitScript(()=>{
 const provider={request:args=>window.depositReadWallet(args),on(){},removeListener(){}}
 localStorage.setItem('saffron.incentives.selected-wallet-rdns','test.deposit')
 window.addEventListener('eip6963:requestProvider',()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'deposit-fixture',rdns:'test.deposit',name:'Deposit fixture wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'},provider}})))
})
const modal=page.locator('[data-incentive-modal]'),invalidate=()=>page.evaluate(()=>window.dispatchEvent(new Event('saffron:vault-updated')))
/** Prove actual browser paint, not just a class name. Disabled controls keep
 * their native gate and dimmed appearance; keyboard focus stays visible. */
async function purpleDeposit(button,disabled=false){
 await expect(button).toHaveAttribute('data-incentive-primary-action','')
 const paint=await button.evaluate(node=>{const s=getComputedStyle(node);return {background:s.backgroundImage,opacity:s.opacity}})
 assert.match(paint.background,/radial-gradient/);assert.match(paint.background,/linear-gradient/)
 assert.match(paint.background,/210, 134, 255/)
 if(disabled){
  await expect(button).toBeDisabled()
  // The shared button animates opacity; assert its settled disabled state.
  await expect.poll(()=>button.evaluate(node=>getComputedStyle(node).opacity)).toBe('0.5')
 }
 else{
  await expect(button).toBeEnabled();await button.hover()
  assert.equal(await button.evaluate(node=>getComputedStyle(node).backgroundImage),paint.background)
  await page.mouse.move(0,0);await page.keyboard.press('Tab');await button.focus()
  assert.equal(await button.evaluate(node=>getComputedStyle(node).outlineStyle),'solid')
 }
}
try{
 await page.goto('http://127.0.0.1:'+server.address().port+base+'/portfolio/vaults')
 await page.locator('[data-deployment-id="'+row.id+'"]').getByRole('button',{name:'View vault'}).click()
 await expect(modal).toHaveCount(1)
 for(const [index,label] of ['Preparing your vault','Creating your vault','Checking your vault','Verifying vault'].entries()){
  row={...row,progress:{...row.progress,activeStage:index+1,reason:index===3?'awaiting_funding':'creating'}};await invalidate()
  await expect(modal.getByRole('status')).toHaveText(label);await expect(modal.locator('[data-request-spinner]')).toHaveCount(1);await expect(modal.getByRole('list',{name:'Vault creation progress'})).toHaveCount(0)
  await expect.poll(()=>modal.locator('img').evaluateAll(nodes=>nodes.length===2&&nodes.every(n=>n.complete&&n.naturalWidth>0))).toBe(true)
  await modal.screenshot({path:resolve(output,'stage-'+(index+1)+'.png')});phases.push(label)
 }
 await page.keyboard.press('Escape');await expect(modal).toHaveCount(0);await page.locator('[data-deployment-id="'+row.id+'"]').getByRole('button',{name:'View vault'}).click();await expect(modal.getByRole('status')).toHaveText('Verifying vault')
 row={...row,state:'ready',depositable:true,progress:{...row.progress,reason:'ready'}};await invalidate();await expect(modal.getByRole('button',{name:'Deposit LP assets'})).toBeEnabled();await expect(modal.locator('[data-request-spinner]')).toHaveAttribute('data-spinning','false')
 await purpleDeposit(modal.getByRole('button',{name:'Deposit LP assets'}))
 await modal.screenshot({path:resolve(output,'deposit-ready-desktop.png')})
 await page.setViewportSize({width:390,height:1050});await modal.screenshot({path:resolve(output,'deposit-ready-mobile.png')})
 unavailable=true;await invalidate();await expect(modal.getByRole('status')).toHaveText('Verification temporarily unavailable');await expect(modal.getByRole('button',{name:'Deposit LP assets'})).toBeDisabled()
 await purpleDeposit(modal.getByRole('button',{name:'Deposit LP assets'}),true)
 await modal.locator('[data-deployment-transactions] summary').click()
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1050});assert(await modal.evaluate(node=>node.scrollWidth<=node.clientWidth))}
 await page.keyboard.press('Escape');await expect(modal).toHaveCount(0)
 const portfolio=page.locator('[data-deployment-id="'+row.id+'"]')
 await purpleDeposit(portfolio.getByRole('button',{name:'Deposit',exact:true}))
 assert(await portfolio.evaluate(node=>node.scrollWidth<=node.clientWidth))
 await page.setViewportSize({width:1440,height:1050});await portfolio.screenshot({path:resolve(output,'deposit-portfolio.png')})
 assert.deepEqual(writes,[]);assert.deepEqual(unknown,[]);assert.deepEqual(errors,[])
 const report={ok:true,release:marker.release,compiledApplication:true,phases,portfolioResume:true,staleReadGate:true,purpleDeposits:true,hoverAndKeyboardFocus:true,disabledOpacity:true,widths:[1440,390,320],walletMethods,walletTransactions:0,productionWrites:0,errors}
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error}
finally{await browser.close();await new Promise(resolve=>server.close(resolve))}
