/** Keep the unmodified production UI open in a dedicated disposable browser.
 * Reuses the repository's actual PostgreSQL/EVM/browser fixtures. Local generated
 * wallets stay in memory. No production config, RPC endpoint or signer is loaded.
 * A root-only Unix socket exposes a small set of explicit local QA operations.
 */
import { createServer } from 'node:net'
import { mkdir,writeFile,chmod,unlink } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { pathToFileURL } from 'node:url'
import { followContextPage } from './qa-page.mjs'

import { app,settings } from './config.mjs'
const root=settings.dataRoot+'/run'
const socketPath=root+'/control.sock'
const fromApp=path=>import(pathToFileURL(app+'/'+path))
const {chromium}=await fromApp('node_modules/@playwright/test/index.mjs')
const {setup}=await fromApp('tests/browser/fixture.mjs')
const {simulateFactory}=await fromApp('worker/fork-simulate.mjs')
const {runOneRequest}=await fromApp('worker/one-shot.mjs')
const {abi}=await fromApp('shared/vault-lifecycle.mjs')
const commit=execFileSync('git',['rev-parse','HEAD'],{cwd:app,encoding:'utf8'}).trim()
if(process.env.SAFFRON_QA_EXPECTED_COMMIT&&commit!==process.env.SAFFRON_QA_EXPECTED_COMMIT)throw new Error('QA source pin changed; review before starting.')
if(process.env.SAFFRON_TEST_DB_HOST!==settings.dataRoot+'/socket')throw new Error('Only the dedicated disposable database is allowed.')
process.chdir(app)
process.umask(0o077)
await mkdir(root,{recursive:true,mode:0o700})
let browser,fixture,timer,control,closing=false,busy=false,sequence=Promise.resolve()
/** Visit every page: paid request count is not a fixture execution limit. */
async function allJobs(){
  const rows=[];let cursor
  do{const page=await fixture.database.list({admin:true,limit:100,cursor});rows.push(...page.jobs);cursor=page.nextCursor}while(cursor)
  return rows
}
const attempts=new Map(),operations=[]

/** Serialize state-changing QA commands with creation, but keep status readable. */
function exclusive(fn){const result=sequence.then(fn);sequence=result.catch(()=>{});return result}

/** Project only public local-test metadata; never expose raw transaction journals. */
async function status(){
  const rows=await allJobs()
  const jobs=[]
  for(const row of rows){
    const observation=await fixture.database.execution.observation(row.id)
    jobs.push({id:row.id,state:row.state,vault:row.plan.vault??null,creation:attempts.get(row.id)??null,
      funding:observation?.verified?{started:observation.isStarted,suppliedRaw:observation.variableSupply,capacityRaw:observation.variableCapacity,endTime:observation.endTime}:null})
  }
  return {environment:'Disposable local contracts; NOT mainnet',commit,origin:fixture.origin,chainId:4663,
    user:fixture.account.address,treasury:fixture.treasuryAddress,creator:fixture.chain.account.address,
    busy,jobs,operations:operations.slice(-20),userTransactions:fixture.state.sends,userMessageSignatures:fixture.state.signs,
    creatorBroadcasts:fixture.chain.broadcasts,clockAdvanced:operations.some(x=>x.action==='mature'),checkedAt:new Date().toISOString()}
}

/** Simulate one exact accepted job, then execute only that request's permanent
 * local permit. The ordinary queue runner is deliberately never started here. */
async function createPending(){
  const rows=await allJobs()
  for(const row of rows){
    if(row.state!=='queued'||attempts.has(row.id))continue
    busy=true;attempts.set(row.id,{state:'simulating'})
    try{
      const job=await fixture.database.getIntent(row.id)
      const simulation=await simulateFactory({upstream:fixture.chain.raw,config:fixture.chain.config,job})
      if(!simulation.ok||simulation.upstreamBroadcasts!==0)throw new Error('Local simulation failed.')
      const directory=root+'/permits/'+row.id
      await mkdir(directory,{recursive:true,mode:0o700})
      await writeFile(directory+'/simulation.json',JSON.stringify(simulation,null,2)+'\n',{mode:0o600})
      attempts.set(row.id,{state:'creating',simulationPassed:true,upstreamBroadcasts:0})
      const result=await runOneRequest({database:fixture.database,rpc:fixture.chain.rpc,account:fixture.chain.account,
        config:fixture.chain.config,requestId:row.id,simulation,directory,pollMs:250,timeoutMs:120000})
      attempts.set(row.id,{state:result.state,simulationPassed:true,upstreamBroadcasts:0})
      operations.push({action:'create',requestId:row.id,state:result.state,time:new Date().toISOString()})
    }catch(error){
      attempts.set(row.id,{state:'needs_attention',reason:'Local creation stopped; inspect private QA diagnostics.'})
      // Diagnostics remain owner-only; no structured transaction/error object is serialized.
      await writeFile(root+'/creation-error.txt',String(error.stack??error.name)+'\n',{mode:0o600})
    }finally{busy=false}
  }
}

/** Treasury operations use the separate generated treasury from the browser fixture.
 * Partial funding is deliberately observable before the user can enter the vault. */
async function fund(partial){
  let count=0
  for(const row of await allJobs()){
    if(row.state!=='created'||!row.plan.vault)continue
    const bearer=await fixture.chain.client.readContract({address:row.plan.vault,abi,functionName:'variableBearerToken'})
    const supplied=await fixture.chain.client.readContract({address:bearer,abi,functionName:'totalSupply'})
    const outstanding=BigInt(row.plan.premium)-supplied
    if(outstanding<=0n)continue
    const amount=partial?(outstanding>1n?outstanding/2n:1n):outstanding
    const receipts=await fixture.fund(row,amount)
    operations.push({action:partial?'fund-half':'fund',requestId:row.id,amountRaw:amount.toString(),transactions:receipts,time:new Date().toISOString()});count++
  }
  return {fundedRequests:count}
}

/** Time travel changes only this local Anvil chain and its fixture UI/API clock.
 * Start a fresh sandbox before testing another new checkout after time travel. */
async function mature(){
  const rows=await allJobs()
  const observations=await Promise.all(rows.map(row=>fixture.database.execution.observation(row.id)))
  const ends=observations.filter(x=>x?.verified&&x.isStarted).map(x=>Number(x.endTime))
  if(!ends.length)return {advanced:false,reason:'Deposit and start a local vault first.'}
  const head=await fixture.chain.raw('eth_getBlockByNumber',['latest',false])
  const end=Math.max(...ends,Number(BigInt(head.timestamp)))+2
  await fixture.advanceTo(end)
  operations.push({action:'mature',timestamp:end,time:new Date().toISOString()})
  return {advanced:true,localTimestamp:end}
}

/** Root-only local command protocol. These are test tools, never production API routes. */
async function command(input){
  if(input.action==='status')return status()
  if(input.action==='fund-half')return exclusive(()=>fund(true))
  if(input.action==='fund')return exclusive(()=>fund(false))
  if(input.action==='mature')return exclusive(mature)
  if(input.action==='screenshot'){
    await fixturePage.screenshot({path:root+'/browser.png',fullPage:true});return {saved:true}
  }
  throw new Error('Unknown local QA command.')
}
let fixturePage
try{
  browser=await chromium.launch({headless:false,args:['--window-size=1440,1020','--window-position=0,0','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+settings.debugPort,'--no-first-run','--disable-dev-shm-usage']})
  const context=await browser.newContext({viewport:{width:1400,height:900}})
  await context.newPage()
  // The fixture's advanceTo callback retains this facade, not a Page that can
  // become closed. Recovery opens a page in the same original wallet context.
  fixturePage=followContextPage(context)
  fixture=await setup(fixturePage,{admin:true,wrap:true,campaign:true})
  // Restrict the remote test browser to this one loopback application. It is not
  // a general-purpose browser for opening unrelated local services or websites.
  await context.route('**/*',route=>{
    const url=new URL(route.request().url())
    if(url.origin===fixture.origin||['data:','blob:','about:'].includes(url.protocol))return route.continue()
    return route.abort('blockedbyclient')
  })
  await fixturePage.goto(fixture.origin)
  await fixturePage.locator('[data-incentive-offer]').first().waitFor()
  try{await unlink(socketPath)}catch(error){if(error.code!=='ENOENT')throw error}
  control=createServer(socket=>{
    let input='';socket.setTimeout(15000,()=>socket.destroy())
    socket.on('data',chunk=>{
      input+=chunk;if(input.length>4096){socket.destroy();return}
      if(!input.includes('\n'))return
      socket.pause()
      Promise.resolve().then(()=>command(JSON.parse(input.split('\n')[0])))
        .then(result=>socket.end(JSON.stringify({ok:true,result})+'\n'))
        .catch(()=>socket.end(JSON.stringify({ok:false,error:'Local QA command failed; inspect the sandbox.'})+'\n'))
    })
  })
  await new Promise(resolve=>control.listen(socketPath,resolve));await chmod(socketPath,0o600)
  let ticking=false
  timer=setInterval(()=>{
    if(ticking||closing)return
    ticking=true
    exclusive(async()=>{await fixture.chain.raw('evm_mine');if(!operations.some(x=>x.action==='mature'))await createPending()})
      .catch(()=>{}).finally(()=>{ticking=false})
  },2000)
  await writeFile(root+'/ready.json',JSON.stringify(await status(),null,2)+'\n',{mode:0o600})
  console.log('Disposable QA browser ready; source '+commit.slice(0,7)+'. Live signer and production services unused.')
  await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);browser.once('disconnected',resolve)})
}finally{
  closing=true;clearInterval(timer);await sequence
  control?.close();await browser?.close();await fixture?.close()
  try{await unlink(socketPath)}catch(error){if(error.code!=='ENOENT')throw error}
}
