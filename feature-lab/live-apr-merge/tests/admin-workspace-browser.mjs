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
const dist=resolve(process.env.MERGE_DIST||'dist'),output=resolve(process.env.MERGE_EVIDENCE||'validation/admin-workspace')
const marker=JSON.parse(await readFile(resolve(dist,'deployment-mode.json'),'utf8')),base=marker.basePath.replace(/\/$/,'')
const signer=privateKeyToAccount(generatePrivateKey()),wallet=signer.address.toLowerCase()
const address='0x'+'12'.repeat(20),token={address,symbol:'CASHCAT',decimals:18}
const pairs=[{id:'pair-1',revision:1,chainId:4663,pool:address,feeTier:3000,token0:token,token1:{address:'0x'+'34'.repeat(20),symbol:'WETH',decimals:18},active:true}]
const programs=[1,2].map(i=>({id:'campaign-11111111-1111-4111-8111-'+String(i).padStart(12,'0'),revision:1,pairId:'pair-1',budgetPoolId:'budget-'+i,apr:121.6666666667,days:i===1?3:7,requestFeeWei:'1000000000000001',minimumCents:1,maximumCents:100000000,sortOrder:i,isNew:false,active:true}))
const budgets=programs.map((p,i)=>({id:p.budgetPoolId,name:'CASHCAT / WETH · '+p.days+' days',revision:1,chainId:4663,rewardAsset:address,decimals:18,limitRaw:'10000',reservedRaw:'0',allocatedRaw:'0',availableRaw:'10000',paused:i===1,reconciliationRequired:false,advisoryBudgetCents:'1000000',campaign:{days:p.days,aprPercent:'121.6666666667',budgetCents:'1000000',capacityCents:'100000000'},accounting:{budgetCents:'1000000',fundedBudgetCents:'500000',reservedBudgetCents:'250000',fundedCapacityCents:'50000000',availableCapacityCents:'50000000',fixedDepositedCents:'15000000'}}))
// Frozen USD request snapshots are distinct from live funded/reserved totals.
const completeStats={scope:'all-accepted-requests',requestCount:'3',totalLpCents:'130001',averageLpCents:'43334',maximumLpCents:'90000',totalPremiumCents:'1310',averagePremiumCents:'437',maximumPremiumCents:'907',unvaluedLpRequests:'0',unvaluedPremiumRequests:'0'}
budgets[0].advisoryBudgetCents='123456';budgets[0].requestStatistics=completeStats
Object.assign(budgets[0].accounting,{fundedBudgetCents:'610',reservedBudgetCents:'700',fundedCapacityCents:'80000',reservedCapacityCents:'50001',availableCapacityCents:'99869999',fixedDepositedCents:'30001'})
Object.assign(budgets[1].accounting,{fundedBudgetCents:'0',reservedBudgetCents:'0',fundedCapacityCents:'0',reservedCapacityCents:'0',availableCapacityCents:'100000000',fixedDepositedCents:'0'})
budgets[1].requestStatistics={...completeStats,requestCount:'0',totalLpCents:'0',totalPremiumCents:'0',averageLpCents:null,maximumLpCents:null,averagePremiumCents:null,maximumPremiumCents:null}
const refundPayments=[1,2,3].map(i=>({hash:'0x'+String(i).repeat(64),deployment_id:'refund-'+i+'-full-request-id',wallet,revision:7,state:i===3?'refund_pending':i===2?'needs_attention':'admitted',amount_wei:i===2?'200000000000000':'4000000000000000'}))
let failRefunds=false
const refundBatch={id:'fixture-refund-batch',state:'prepared',outstandingWei:'4200000000000000',csv:'recipient,amount\n'+wallet+',0.0042\n',manifest:{items:refundPayments.slice(0,2),recipients:[{wallet}]},items:refundPayments.slice(0,2).map(p=>({hash:p.hash,state:'refund_pending',verifiedWei:'0',originalWei:p.amount_wei,outstandingWei:p.amount_wei})),submissions:[],unmatched:[]}
const refundWrites=[]
const writes=[],unexpected=[],walletMethods=[],errors=[],layouts=[]
let failCatalog=false,missingStatistics=false,origin
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
    if(/^\/admin\/payments\/0x[0-9]+\/refund$/.test(path)){
     const payment=refundPayments.find(p=>path.includes(p.hash));assert(payment);assert.equal(payment.revision,body.revision);assert.equal(body.fundingStopped,true);assert(body.reason.trim().length>=3)
     refundWrites.push({path,body});payment.state='refund_pending';payment.revision++;return send({ok:true})
    }
    if(path==='/admin/refunds/prepare'){assert(body.payments.every(hash=>refundPayments.some(p=>p.hash===hash&&p.state==='refund_pending')));refundWrites.push({path,body});return send(refundBatch)}
    if(path==='/admin/refunds/'+refundBatch.id+'/submit'){refundWrites.push({path,body});refundBatch.state='submitted';refundBatch.submissions=body.hashes.map(hash=>({hash,state:'pending'}));return send(refundBatch)}
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
   if(path==='/admin/payments')return failRefunds?send({error:'Fixture refunds unavailable'},503):send({payments:refundPayments,nextCursor:null})
   if(path==='/admin/refunds')return send({batches:[{id:refundBatch.id,state:refundBatch.state}]})
   if(path==='/admin/refunds/'+refundBatch.id)return send(refundBatch)
   if(path==='/admin/catalog')return failCatalog?send({error:'Fixture catalog unavailable'},503):send({pairs,programs,budgets:missingStatistics?budgets.map(({requestStatistics,...budget})=>budget):budgets})
   if(path==='/admin/health')return send({checkedAt:new Date().toISOString(),checks:[{id:'campaigns',title:'Campaign funding',detail:'Campaigns need external funding.',owner:'Campaign operator',action:'Review Campaigns.',state:'blocked',scope:'shared'}],canQuote:false,readiness:{},metrics:{}})
   if(path==='/admin/configuration')return send({checkedAt:new Date().toISOString(),settings:[]})
   if(path==='/admin/tokens')return send({tokens:pairs.flatMap(p=>[p.token0,p.token1]),source:'fixture'})
   if(path==='/admin/deployments'||path==='/deployments')return send({deployments:[],nextCursor:null})
   if(path==='/positions')return send({positions:[]})
   if(path==='/admin/portfolio-capacity')return send({campaigns:[]})
   if(path==='/payments')return send({payments:[]})
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
await context.exposeFunction('programFixtureWallet',async({method,params})=>{
 walletMethods.push(method)
 if(['eth_accounts','eth_requestAccounts'].includes(method))return [wallet]
 if(method==='eth_chainId')return '0x1237'
 if(method==='personal_sign')return signer.signMessage({message:{raw:params[0]}})
 throw Error('Wallet write forbidden in campaign UI fixture: '+method)
})
await context.addInitScript(()=>{
 const provider={request:args=>window.programFixtureWallet(args),on(){},removeListener(){}}
 const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail:{info:{uuid:'campaign-fixture',name:'Program fixture wallet',rdns:'test.campaign',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'},provider}}))
 localStorage.setItem('saffron.incentives.selected-wallet-rdns','test.campaign')
 window.addEventListener('eip6963:requestProvider',announce)
})
/** Inspect expanded content too: collapsed disclosure overflow is otherwise
 * invisible. Inputs must remain onscreen at 320px without horizontal scrolling. */
async function layout(label,width){
 await page.setViewportSize({width,height:1100})
 await page.evaluate(()=>{for(const d of document.querySelectorAll('main details'))d.open=true})
 const metrics=await page.evaluate(()=>({viewport:innerWidth,pageWidth:document.documentElement.scrollWidth,table:document.querySelector('table[aria-label="Incentive program configuration"]')?getComputedStyle(document.querySelector('table[aria-label="Incentive program configuration"] tbody tr')).display:null}))
 assert(metrics.pageWidth<=width,JSON.stringify({label,...metrics}))
 for(const input of await page.locator('main input:visible,main select:visible').all()){
  const r=await input.boundingBox();assert(r.x>=0&&r.x+r.width<=width+1,JSON.stringify({label,input:r,width}))
 }
 layouts.push({label,...metrics});await page.screenshot({path:resolve(output,label+'-'+width+'.png'),fullPage:true})
}
/** Audit rendered text plus accessible copy on each actual route. Raw legacy
 * IDs may exist in data attributes/wire fixtures but never in display copy. */
async function language(){
 const text=await page.locator('body').innerText()
 const labels=await page.locator('[aria-label],[title],[placeholder]').evaluateAll(nodes=>nodes.map(n=>['aria-label','title','placeholder'].map(a=>n.getAttribute(a)||'').join(' ')).join(' '))
 assert(!/campaign/i.test(text+' '+labels),'Old terminology in '+page.url())
}
const ref=id=>id.replace(/^campaign-/,'program-')
const openFirst=async()=>{const button=page.getByRole('button',{name:'Open incentive program '+ref(programs[0].id)});await button.focus();await page.keyboard.press('Enter');await expect(page.getByRole('region',{name:'Incentive program details'})).toBeVisible()}
try{
 await page.goto(origin+base+'/campaigns?retained=yes')
 await expect(page).toHaveURL(origin+base+'/incentive-programs?retained=yes')
 await expect(page.getByRole('list',{name:'Incentive programs'})).toBeVisible()
 assert.equal(writes.length,0)
 await expect(page.getByRole('form',{name:'Create incentive program'})).toHaveCount(0)
 for(const width of [1440,1024,768,390,320])await layout('directory',width)
 await language()
 await page.getByRole('searchbox',{name:'Find a program'}).fill('7 days')
 await expect(page.getByRole('list',{name:'Incentive programs'}).getByRole('listitem')).toHaveCount(1)
 await expect(page.getByRole('list',{name:'Incentive programs'})).toContainText('Paused')
 await page.getByRole('searchbox',{name:'Find a program'}).fill(ref(programs[0].id))
 await expect(page.getByRole('list',{name:'Incentive programs'}).getByRole('listitem')).toHaveCount(1)
 await page.getByRole('searchbox',{name:'Find a program'}).fill('')
 await openFirst()
 await page.reload();await expect(page.getByRole('region',{name:'Incentive program details'})).toBeVisible()
 const first=page.getByRole('region',{name:'Incentive program details'})
 await expect(first.getByText(ref(programs[0].id),{exact:true})).toBeVisible()
 await first.getByLabel('Request fee ETH for '+ref(programs[0].id)).fill('0.123456789012345678')
 await first.getByRole('button',{name:'Save request fee'}).click()
 await expect(page.getByRole('status').filter({hasText:'Incentive program configuration saved.'})).toBeVisible()
 assert.equal(writes[0].body.requestFeeWei,'123456789012345678');assert.equal(writes[0].body.id,programs[0].id)
 await first.getByRole('button',{name:'Pause incentive program'}).click();await expect(first.getByRole('button',{name:'Resume incentive program'})).toBeVisible()
 await page.evaluate(()=>{for(const d of document.querySelectorAll('main details'))d.open=true})
 const accounting=page.locator('[data-accounting-budget-id="budget-1"]')
 await expect(accounting.getByLabel('Funding highlights')).toContainText('$1,234.56')
 for(const [name,value]of [['LP requests','3'],['Average LP size','$433.34'],['Maximum LP size','$900.00'],['Total LP requested','$1,300.01'],['Average premium request','$4.37'],['Maximum premium request','$9.07'],['Total premium requested','$13.10']])await expect(accounting.locator('[data-accounting-metric="'+name+'"] td').first()).toHaveText(value)
 missingStatistics=true;await page.getByRole('button',{name:'Reload incentive programs'}).click()
 await expect(accounting.locator('[data-accounting-metric="LP requests"] td').first()).toHaveText('Unavailable')
 missingStatistics=false;await page.getByRole('button',{name:'Reload incentive programs'}).click()
 await expect(accounting.locator('[data-accounting-metric="LP requests"] td').first()).toHaveText('3')
 for(const width of [1440,1024,768,390,320])await layout('program-detail',width)
 await language()
 await page.getByRole('button',{name:'All incentive programs'}).click()
 await expect(page.getByRole('list',{name:'Incentive programs'})).toBeVisible()
 await page.evaluate(()=>{for(const d of document.querySelectorAll('main details'))d.open=true})
 await expect(page.locator('[data-accounting-budget-id="budget-2"] [data-accounting-metric="Average LP size"] td').first()).toHaveText('—')
 await page.getByRole('button',{name:'Add pair',exact:true}).click();await expect(page.getByRole('form',{name:'Add pair'})).toBeVisible();await layout('pair-expanded',320)
 await page.getByRole('button',{name:'Close pair form'}).click()
 await page.getByRole('button',{name:'New incentive program',exact:true}).click()
 await expect(page).toHaveURL(origin+base+'/incentive-programs/new')
 await expect(page.getByRole('heading',{name:'Create incentive program',exact:true})).toBeVisible()
 await expect(page.getByRole('list',{name:'Incentive programs'})).toHaveCount(0)
 await expect(page.getByRole('form',{name:'Create incentive program'})).toBeVisible()
 await page.reload();await expect(page.getByRole('form',{name:'Create incentive program'})).toBeVisible()
 await expect(page).toHaveTitle('Create incentive program · Saffron')
 for(const width of [1440,768,390,320])await layout('create',width)
 await language()
 await page.getByLabel('Incentive program request fee ETH').fill('0.000000000000000001')
 await page.getByLabel('Calculate incentive program field').selectOption('budget')
 await expect(page.getByLabel('Incentive program budget USD')).toHaveAttribute('readonly','')
 await page.getByRole('button',{name:'Create incentive program',exact:true}).click()
 await expect(page).toHaveURL(origin+base+'/incentive-programs')
 await expect(page.getByRole('list',{name:'Incentive programs'})).toBeVisible()
 const creation=writes.find(w=>w.path==='/admin/campaigns').body
 assert.equal(creation.requestFeeWei,'1');assert.equal(creation.active,false);assert(!('budgetUsd' in creation))
 await page.goBack();await expect(page).toHaveURL(origin+base+'/incentive-programs/new');await expect(page.getByRole('form',{name:'Create incentive program'})).toBeVisible()
 await page.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page).toHaveURL(origin+base+'/incentive-programs')
 await openFirst()
 failCatalog=true;await page.getByRole('button',{name:'Reload incentive programs'}).click();await expect(page.getByRole('alert').filter({hasText:'Fixture catalog unavailable'})).toBeVisible()
 await expect(page.getByLabel('Request fee ETH for '+ref(programs[0].id))).toBeDisabled()
 failCatalog=false;await page.getByRole('button',{name:'Reload incentive programs'}).click();await expect(page.getByLabel('Request fee ETH for '+ref(programs[0].id))).toBeEnabled()
 for(const route of ['/','/admin','/status','/journey','/portfolio/vaults']){
  await page.goto(origin+base+route);await page.waitForLoadState('networkidle');await language();await layout('route-'+(route.split('/').at(-1)||'home'),390)
 }
 await page.goto(origin+base+'/admin');await expect(page.getByRole('button',{name:'Incentive programs',exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Incentive programs',exact:true}).click();await page.getByRole('button',{name:'Load incentive catalog',exact:true}).click()
 await expect(page.getByRole('list',{name:'Incentive programs'})).toBeVisible();await language();await layout('admin-tab',1440);await layout('admin-tab',320)
 await openFirst()
 await expect(page.getByRole('list',{name:'Incentive programs'})).toBeVisible()
 const p3=page.getByRole('region',{name:'Program configuration'})
 await page.setViewportSize({width:1440,height:1100})
 const left=await page.getByRole('complementary',{name:'Incentive program navigator'}).boundingBox(),right=await page.getByRole('region',{name:'Incentive program details'}).boundingBox()
 assert(left.x+left.width<right.x,'P3 navigator must be alongside selected details on desktop')
 const apr=page.getByRole('region',{name:'Incentive program details'}).getByText('121.6667%',{exact:false}).first()
 assert.equal(await apr.evaluate(e=>getComputedStyle(e).color),'rgb(255, 188, 9)')
 await p3.screenshot({path:resolve(output,'P3-implemented-desktop.png')})
 await layout('p3-selected',390);await p3.screenshot({path:resolve(output,'P3-implemented-mobile.png')})
 await page.getByRole('button',{name:'Refunds',exact:true}).click()
 await page.getByRole('button',{name:'Load refund requests'}).click()
 await expect(page.getByRole('table',{name:'Refund requests'})).toBeVisible()
 for(const p of refundPayments.slice(0,2))await page.getByRole('checkbox',{name:'Select refund request '+p.hash}).check()
 const approval=page.getByRole('button',{name:'Approve selected full-fee refunds and stop creation'})
 await expect(approval).toBeDisabled()
 await page.getByLabel('Unfulfillable reason').selectOption('funding_unavailable')
 await page.getByLabel('Operator explanation').fill('Premium cannot be funded in this disposable fixture.')
 await page.getByRole('checkbox',{name:/External funder has stopped work/}).check();await expect(approval).toBeEnabled()
 await expect(page.getByLabel('Refund summary')).toContainText('0.0042')
 for(const width of [1440,1024,768,390,320])await layout('r1-review',width)
 await page.setViewportSize({width:1440,height:1100});await page.getByRole('table',{name:'Refund requests'}).locator('details').evaluateAll(nodes=>nodes.forEach(node=>node.open=false));await page.getByRole('region',{name:'Refund management'}).screenshot({path:resolve(output,'R1-implemented-desktop.png')})
 await language()
 failRefunds=true;await page.getByRole('button',{name:'Refresh refunds'}).click();await expect(page.getByRole('region',{name:'Refund management'}).getByRole('alert')).toContainText('Fixture refunds unavailable');await expect(approval).toBeDisabled()
 failRefunds=false;await page.getByRole('button',{name:'Refresh refunds'}).click();await expect(approval).toBeEnabled()
 await approval.click();await expect(page.getByLabel('Refund summary')).toContainText('Approved');await expect(approval).toBeDisabled()
 await page.getByLabel('Approved refund sender address').fill(wallet)
 await page.getByRole('button',{name:'Prepare selected refund batch'}).click()
 await expect(page.getByRole('region',{name:'Refund batch '+refundBatch.id})).toBeVisible()
 assert.deepEqual(refundWrites[2].body.payments,refundPayments.slice(0,2).map(p=>p.hash));assert(refundWrites[2].body.requestKey)
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download original batch CSV'}).click();const csv=await downloaded;await csv.saveAs(resolve(output,'original-refund.csv'));assert.equal(await readFile(resolve(output,'original-refund.csv'),'utf8'),refundBatch.csv)
 const tx='0x'+'a'.repeat(64);await page.getByLabel('External transaction hashes, one per line').fill(tx);await page.getByRole('button',{name:'Record hashes for verification'}).click();await expect(page.getByLabel('External transaction hashes, one per line')).toHaveValue('')
 assert.deepEqual(refundWrites[3].body,{hashes:[tx]});assert.equal(refundWrites.length,4)
 for(const width of [1440,390,320])await layout('r1-verification',width)
 await page.getByRole('region',{name:'Refund management'}).screenshot({path:resolve(output,'R1-implemented-mobile.png')})
 await page.getByRole('button',{name:'Incentive programs',exact:true}).click()
 await page.getByRole('button',{name:'New incentive program',exact:true}).first().click();await expect(page).toHaveURL(origin+base+'/incentive-programs/new')
 await page.goto(origin+base+'/campaigns/new?keep=yes#review');await expect(page).toHaveURL(origin+base+'/incentive-programs/new?keep=yes#review')
 await expect(page.getByRole('form',{name:'Create incentive program'})).toBeVisible();await language()
 await page.goto(origin+base+'/?view=campaigns&keep=yes');await expect(page).toHaveURL(origin+base+'/incentive-programs?keep=yes')
 await expect(page.getByRole('list',{name:'Incentive programs'})).toBeVisible()
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.equal(writes.length,3)
 const report={ok:true,release:marker.release,layouts,checks:['card directory and selected program','search and disabled programs','exact fee edit and canonical IDs','pause budget','separate creation and exact payload','keyboard navigation','new and legacy routes with query/hash','program deep-link reload','browser history','admin tab parity','expanded pair form','failed reload disables stale settings','unchanged request statistics','all-route visible and accessible terminology'],fixtureWrites:writes.map(w=>w.path),refundFixtureWrites:refundWrites.map(w=>w.path),selectedDesigns:['P3','R1'],walletTransactions:0,productionWrites:0,errors}
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}catch(e){await writeFile(resolve(output,'failure.json'),JSON.stringify({errors,unexpected,writes,layouts},null,2));await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw e}
finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
