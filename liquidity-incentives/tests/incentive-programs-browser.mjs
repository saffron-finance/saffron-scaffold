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
const dist=resolve(process.env.STANDALONE_DIST||'dist'),output=resolve(process.env.PROGRAM_EVIDENCE||'validation/incentive-programs')
const base=(process.env.STANDALONE_BASE||'/').replace(/\/$/,'')
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
   if(path==='/admin/catalog')return failCatalog?send({error:'Fixture catalog unavailable'},503):send({pairs,programs,budgets:missingStatistics?budgets.map(({requestStatistics,...budget})=>budget):budgets})
   if(path==='/admin/health')return send({checkedAt:new Date().toISOString(),checks:[{id:'campaigns',title:'Campaign funding',detail:'Campaigns need external funding.',owner:'Campaign operator',action:'Review Campaigns.',state:'blocked',scope:'shared'}],canQuote:false,readiness:{},metrics:{}})
   if(path==='/admin/configuration')return send({checkedAt:new Date().toISOString(),settings:[]})
   if(path==='/admin/tokens')return send({tokens:pairs.flatMap(p=>[p.token0,p.token1]),source:'fixture'})
   if(path==='/admin/status')return send({creatorOnline:false,watcherOnline:false,acceptingRequests:false})
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
/** Standalone shell integration uses the same in-memory financial boundary.
 * It never starts a database, worker, local chain, or production API. */
try{
 await page.goto(origin+base+'/campaigns?keep=yes')
 await expect(page).toHaveURL(origin+base+'/incentive-programs?keep=yes')
 await expect(page.getByRole('list',{name:'Incentive programs'})).toBeVisible()
 await page.getByRole('button',{name:'Open incentive program program-11111111-1111-4111-8111-000000000001'}).click()
 const detail=page.getByRole('region',{name:'Incentive program details'})
 await expect(detail).toBeVisible()
 await detail.getByLabel('Request fee ETH for program-11111111-1111-4111-8111-000000000001').fill('0.123456789012345678')
 await detail.getByRole('button',{name:'Save request fee'}).click()
 await expect(page.getByRole('status').filter({hasText:'Incentive program configuration saved.'})).toBeVisible()
 assert.equal(writes[0].body.id,programs[0].id);assert.equal(writes[0].body.requestFeeWei,'123456789012345678')
 for(const width of [1440,390,320]){
  await page.setViewportSize({width,height:1000})
  await page.evaluate(()=>{for(const d of document.querySelectorAll('details'))d.open=true})
  assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),String(width))
 }
 await page.getByRole('button',{name:'All incentive programs'}).click()
 await page.getByRole('button',{name:'New incentive program'}).click()
 await expect(page).toHaveURL(origin+base+'/incentive-programs/new')
 await expect(page.getByRole('form',{name:'Create incentive program'})).toBeVisible()
 await page.getByLabel('Incentive program request fee ETH').fill('0.000000000000000001')
 await page.getByRole('button',{name:'Create incentive program',exact:true}).click()
 await expect(page).toHaveURL(origin+base+'/incentive-programs')
 await expect(page.getByRole('list',{name:'Incentive programs'})).toBeVisible()
 assert.equal(writes[1].body.requestFeeWei,'1');assert.equal(writes[1].path,'/admin/campaigns')
 for(const route of ['/','/admin','/journey','/status','/portfolio/vaults','/incentive-programs/new']){
  await page.goto(origin+base+route);await page.waitForLoadState('networkidle')
  assert(!/campaign/i.test(await page.locator('body').innerText()),route)
 }
 assert.deepEqual(errors,[]);assert.deepEqual(unexpected,[]);assert.equal(writes.length,2)
 const report={ok:true,standalone:true,cardDirectory:true,selectedProgram:true,legacyLinks:true,separateCreation:true,exactCanonicalPayloads:true,widths:[1440,390,320],allRouteTerminology:true,fixtureWrites:2,productionWrites:0,walletTransactions:0,errors}
 await writeFile(resolve(output,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report))
}finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r))}
