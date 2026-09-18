import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve,extname,sep} from 'node:path'
import {once} from 'node:events'
import {chromium,expect} from '@playwright/test'
import {generatePrivateKey,privateKeyToAccount} from 'viem/accounts'

/** Compiled-frontend contract fixture. No backend, database, chain process or
 * production service is used. The local HTTP server owns all test mutations;
 * every wallet method other than account/chain reads and sign-in is rejected. */
const dist=resolve(process.env.MERGE_DIST||'dist'),output=resolve(process.env.MERGE_EVIDENCE||'validation/campaign-management')
const marker=JSON.parse(await readFile(resolve(dist,'deployment-mode.json'),'utf8')),base=marker.basePath.replace(/\/$/,'')
const signer=privateKeyToAccount(generatePrivateKey()),wallet=signer.address.toLowerCase()
const address='0x'+'12'.repeat(20),token={address,symbol:'CASHCAT',decimals:18}
const pairs=[{id:'pair-1',revision:1,chainId:4663,pool:address,feeTier:3000,token0:token,token1:{address:'0x'+'34'.repeat(20),symbol:'WETH',decimals:18},active:true}]
const programs=[1,2].map(i=>({id:'campaign-11111111-1111-4111-8111-'+String(i).padStart(12,'0'),revision:1,pairId:'pair-1',budgetPoolId:'budget-'+i,apr:121.6666666667,days:i===1?3:7,requestFeeWei:'1000000000000001',minimumCents:1,maximumCents:100000000,sortOrder:i,isNew:false,active:true}))
const budgets=programs.map((p,i)=>({id:p.budgetPoolId,name:'CASHCAT / WETH · '+p.days+' days',revision:1,chainId:4663,rewardAsset:address,decimals:18,limitRaw:'10000',reservedRaw:'0',allocatedRaw:'0',availableRaw:'10000',paused:i===1,reconciliationRequired:false,advisoryBudgetCents:'1000000',campaign:{days:p.days,aprPercent:'121.6666666667',budgetCents:'1000000',capacityCents:'100000000'},accounting:{budgetCents:'1000000',fundedBudgetCents:'500000',reservedBudgetCents:'250000',fundedCapacityCents:'50000000',availableCapacityCents:'50000000',fixedDepositedCents:'15000000'}}))
const writes=[],unexpected=[],walletMethods=[],errors=[],layouts=[]
let failCatalog=false,origin
const session=()=>({wallet,csrf:'disposable-local-fixture',operator:true,expires:Date.now()+3600000})
/** Minimal strict wire boundary: unexpected writes fail instead of being
 * silently accepted, and revision checks mirror the existing API contract. */
const server=createServer(async(req,res)=>{
 try{
  const pathname=new URL(req.url,'http://fixture').pathname
  const send=(value,status=200)=>{res.writeHead(status,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(value))}
  if(pathname.startsWith(base+'/api/incentives/')){
   const path=pathname.slice((base+'/api/incentives').length)
   if(req.method==='POST'){
    let raw='';for await(const chunk of req)raw+=chunk
    const body=JSON.parse(raw)
    if(path==='/session/challenge')return send({origin,wallet,chainId:4663,nonce:'fixture-only',expiresAt:new Date(Date.now()+60000).toISOString()})
    if(path==='/session/login')return send({session:session()})
    if(path==='/admin/programs'){
     const p=programs.find(p=>p.id===body.id);if(!p||p.revision!==body.revision)return send({error:'Program revision conflict.'},409)
     writes.push({path,body});Object.assign(p,body,{revision:p.revision+1});return send({program:p})
    }
    if(path==='/admin/budgets'){
     const b=budgets.find(b=>b.id===body.id);if(!b||b.revision!==body.revision)return send({error:'Budget revision conflict.'},409)
     writes.push({path,body});Object.assign(b,body,{revision:b.revision+1});return send({budget:b})
    }
    if(path==='/admin/campaigns'){writes.push({path,body});return send({programId:'fixture-created'},201)}
    unexpected.push(req.method+' '+path);return send({error:'Unexpected fixture write'},500)
   }
   if(path==='/session')return send({session:session()})
   if(path==='/programs')return send({offers:[],creatorOnline:false,readiness:{canQuote:false}})
   if(path==='/admin/catalog')return failCatalog?send({error:'Fixture catalog unavailable'},503):send({pairs,programs,budgets})
   if(path==='/admin/health')return send({checkedAt:new Date().toISOString(),checks:[],canQuote:false,readiness:{},metrics:{}})
   if(path==='/admin/configuration')return send({checkedAt:new Date().toISOString(),settings:[]})
   if(path==='/admin/tokens')return send({tokens:pairs.flatMap(p=>[p.token0,p.token1]),source:'fixture'})
   if(path==='/admin/deployments')return send({deployments:[],nextCursor:null})
   unexpected.push(req.method+' '+path);return send({error:'Unexpected fixture read'},404)
  }
  let filename=resolve(dist,decodeURIComponent(pathname.slice(base.length)).replace(/^\//,''))
  assert(filename.startsWith(dist+sep)||filename===dist)
  if(!extname(filename))filename=resolve(dist,'index.html')
  const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'}
  const bytes=await readFile(filename);res.writeHead(200,{'content-type':types[extname(filename)]||'application/octet-stream'});res.end(bytes)
 }catch(e){res.writeHead(500);res.end('Fixture failure');unexpected.push(String(e))}
})
server.listen(0,'127.0.0.1');await once(server,'listening');origin='http://127.0.0.1:'+server.address().port
await mkdir(output,{recursive:true})
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100}}),page=await context.newPage()
page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(12000)
await context.exposeFunction('campaignFixtureWallet',async({method,params})=>{
 walletMethods.push(method)
 if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet]
 if(method==='eth_chainId')return '0x1237'
 if(method==='personal_sign')return signer.signMessage({message:{raw:params[0]}})
 throw Error('Wallet write forbidden in campaign UI fixture: '+method)
})
await context.addInitScript(()=>{
 const provider={request:args=>window.campaignFixtureWallet(args),on(){},removeListener(){}}
 const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'campaign-fixture',name:'Campaign fixture wallet',rdns:'test.campaign',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'},provider}}))
 localStorage.setItem('saffron.incentives.selected-wallet-rdns','test.campaign')
 window.addEventListener('eip6963:requestProvider',announce)
})
/** Inspect expanded content too: collapsed disclosure overflow is otherwise
 * invisible. Inputs must remain onscreen at 320px without horizontal scrolling. */
async function layout(label,width){
 await page.setViewportSize({width,height:1100})
 await page.evaluate(()=>{for(const d of document.querySelectorAll('main details'))d.open=true})
 const metrics=await page.evaluate(()=>({viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,table:document.querySelector('table[aria-label="Campaign configuration"]')?getComputedStyle(document.querySelector('table[aria-label="Campaign configuration"] tbody tr')).display:null}))
 assert(metrics.pageWidth<=width,JSON.stringify({label,...metrics}))
 for(const input of await page.locator('main input:visible,main select:visible').all()){
  const r=await input.boundingBox();assert(r.x>=0&&r.x+r.width<=width+1,JSON.stringify({label,input:r,width}))
 }
 layouts.push({label,...metrics});await page.screenshot({path:resolve(output,label+'-'+width+'.png'),fullPage:true})
}
try{
 await page.goto(origin+base+'/campaigns')
 await expect(page.getByRole('table',{name:'Campaign configuration'})).toBeVisible()
 assert.equal(writes.length,0)
 await expect(page.getByRole('form',{name:'Create campaign'})).toHaveCount(0)
 const first=page.locator('[data-program-id="'+programs[0].id+'"]')
 await expect(first.getByText(programs[0].id,{exact:true})).toBeVisible()
 await first.getByLabel('Request fee ETH for '+programs[0].id).fill('0.123456789012345678')
 await first.getByRole('button',{name:'Save request fee'}).click()
 await expect(page.getByRole('status').filter({hasText:'Campaign configuration saved.'})).toBeVisible()
 assert.equal(writes[0].body.requestFeeWei,'123456789012345678')
 await first.getByRole('button',{name:'Pause campaign'}).click();await expect(first.getByRole('button',{name:'Resume campaign'})).toBeVisible()
 for(const width of [1440,1024,768,390,320])await layout('manager',width)
 await page.getByRole('button',{name:'Add pair',exact:true}).click();await expect(page.getByRole('form',{name:'Add pair'})).toBeVisible();await layout('pair-expanded',320)
 await page.getByRole('button',{name:'Close pair form'}).click()
 const newButton=page.getByRole('button',{name:'New campaign',exact:true})
 await newButton.focus();await page.keyboard.press('Enter')
 await expect(page).toHaveURL(origin+base+'/campaigns/new')
 await expect(page.getByRole('heading',{name:'Create campaign',exact:true})).toBeVisible()
 await expect(page.getByRole('table',{name:'Campaign configuration'})).toHaveCount(0)
 await expect(page.getByRole('form',{name:'Create campaign'})).toBeVisible()
 await page.reload();await expect(page.getByRole('form',{name:'Create campaign'})).toBeVisible()
 await expect(page).toHaveTitle('Create campaign · Saffron')
 for(const width of [1440,768,390,320])await layout('create',width)
 await page.getByLabel('Campaign request fee ETH').fill('0.000000000000000001')
 await page.getByLabel('Calculate campaign field').selectOption('budget')
 await expect(page.getByLabel('Campaign budget USD')).toHaveAttribute('readonly','')
 await page.getByRole('button',{name:'Create campaign',exact:true}).click()
 await expect(page).toHaveURL(origin+base+'/campaigns')
 await expect(page.getByRole('table',{name:'Campaign configuration'})).toBeVisible()
 const creation=writes.find(w=>w.path==='/admin/campaigns').body
 assert.equal(creation.requestFeeWei,'1');assert.equal(creation.active,false);assert(!('budgetUsd' in creation))
 await page.goBack();await expect(page).toHaveURL(origin+base+'/campaigns/new');await expect(page.getByRole('form',{name:'Create campaign'})).toBeVisible()
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page).toHaveURL(origin+base+'/campaigns')
 await expect(page.getByRole('table',{name:'Campaign configuration'})).toBeVisible()
 failCatalog=true;await page.getByRole('button',{name:'Reload campaigns'}).click();await expect(page.getByRole('alert').filter({hasText:'Fixture catalog unavailable'})).toBeVisible()
 await expect(page.getByLabel('Request fee ETH for '+programs[0].id)).toBeDisabled()
 failCatalog=false;await page.getByRole('button',{name:'Reload campaigns'}).click();await expect(page.getByLabel('Request fee ETH for '+programs[0].id)).toBeEnabled()
 await page.goto(origin+base+'/admin');await expect(page.getByRole('button',{name:'New campaign',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'New campaign',exact:true}).click();await expect(page).toHaveURL(origin+base+'/campaigns/new')
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.equal(writes.length,3)
 const report={ok:true,release:marker.release,layouts,checks:['exact fee edit','pause budget','no inline creation','keyboard navigation','nested deep-link reload','browser history','admin new-campaign link','expanded pair form','failed reload disables stale settings'],fixtureWrites:writes.map(w=>w.path),walletTransactions:0,productionWrites:0,errors}
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(e){await writeFile(resolve(output,'failure.json'),JSON.stringify({errors,unexpected,writes,layouts},null,2));await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw e}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
