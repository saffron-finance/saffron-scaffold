/** Isolated recovery regressions; no real test browser, fixture or wallet is
 * touched. Fake DevTools sessions reject every method outside the recovery path.
 */
import { readFile,writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { chromium,expect } from '@playwright/test'
import { reopenTarget,browserStatus } from '../qa-browser.mjs'

const fixture={"environment": "Disposable local contracts; NOT mainnet", "commit": "8c912ee0c69f7db7c0fe4ba62bc5036486965647", "origin": "http://127.0.0.1:36859", "chainId": 4663, "user": "0x310A7029dA8Ea4846De91B581DF831d552Be9FFA", "treasury": "0x62CCEE49c74d264351e13eC4ec9B761F8b9e4EE0", "creator": "0xc3556175B5f5cE055bC0C1563b7ac73F7e1994b2", "busy": false, "jobs": [{"id": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "state": "created", "vault": "0x05ba59cd117a11232e9f9005d08c23a14397f106", "creation": {"state": "created", "simulationPassed": true, "upstreamBroadcasts": 0}, "funding": {"started": true, "suppliedRaw": "500000000000000250001", "capacityRaw": "500000000000000250001", "endTime": "1789413517"}}], "operations": [{"action": "create", "requestId": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "state": "created", "time": "2026-09-11T19:13:55.663Z"}, {"action": "fund", "requestId": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "amountRaw": "500000000000000250001", "transactions": [{"hash": "0x05afdf06e52c6f835c1c52a095c75317052a4ced0279cf94ba6649c3ab825267", "blockNumber": "9675", "blockHash": "0x8ccbdab389c14a02b6556d69eb668592e3af5b815b7425e8039f20f386322987"}, {"hash": "0x3a02f576e0f6772452b9197040979590e5ddb12c94cf95db4b21576d5c7db82e", "blockNumber": "9677", "blockHash": "0xea34139c9d029764734479d5ef2cf2bd108c5f80baec0ff96f85f3194f3df568"}], "time": "2026-09-11T19:18:22.641Z"}, {"action": "mature", "timestamp": 1789413519, "time": "2026-09-11T19:18:41.771Z"}, {"action": "mature", "timestamp": 1789413564, "time": "2026-09-11T19:19:25.405Z"}], "userTransactions": 7, "userMessageSignatures": 0, "creatorBroadcasts": 3, "clockAdvanced": true, "checkedAt": "2026-09-11T20:03:28.177Z"}
const checks=[]
function fakeSession(contexts,targets){
  const calls=[]
  return {calls,send:async(method,params)=>{
    calls.push({method,params})
    if(method==='Target.getBrowserContexts')return {browserContextIds:contexts}
    if(method==='Target.getTargets')return {targetInfos:targets}
    if(method==='Target.createTarget')return {targetId:'restored'}
    if(method==='Target.activateTarget')return {}
    throw Error('Forbidden browser mutation: '+method)
  }}
}
const closed=fakeSession(['original-wallet-context'],[])
assert.deepEqual(await reopenTarget(closed,fixture),{reopened:true,preserved:true})
assert.deepEqual(closed.calls.find(call=>call.method==='Target.createTarget').params,
  {url:fixture.origin+'/portfolio/vaults',browserContextId:'original-wallet-context'})
checks.push('Closed browser reopens saved requests in the original wallet context')
const open=fakeSession(['original-wallet-context'],[{type:'page',targetId:'existing',browserContextId:'original-wallet-context',url:fixture.origin+'/portfolio/vaults'}])
assert.deepEqual(await reopenTarget(open,fixture),{reopened:false,preserved:true})
assert.equal(open.calls.some(call=>call.method==='Target.createTarget'),false)
assert.deepEqual(open.calls.at(-1),{method:'Target.activateTarget',params:{targetId:'existing'}})
checks.push('Already-open browser is focused without creating, reloading, or resetting')
for(const contexts of [[],['first','second']]){
  const session=fakeSession(contexts,[])
  await assert.rejects(()=>reopenTarget(session,fixture),/unavailable or ambiguous/)
  assert.equal(session.calls.length,1)
}
checks.push('Missing or ambiguous original contexts never start a replacement test')
for(const [targets,expected] of [[[],false],[[{type:'page',url:fixture.origin+'/portfolio/vaults'}],true],[[{type:'page',url:'https://example.com'}],false]]){
  assert.deepEqual(await browserStatus(fixture,{fetcher:async()=>({ok:true,json:async()=>targets})}),{available:true,open:expected})
}
assert.deepEqual(await browserStatus(fixture,{fetcher:async()=>{throw Error('Offline')}}),{available:false,open:false})
checks.push('Closed window and unavailable browser process are distinct status states')

const html=await readFile(new URL('../qa.html',import.meta.url),'utf8')
const browser=await chromium.launch({headless:true})
try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}})
  let reopened=false,fail=false,posts=[]
  await page.route('**/*',async route=>{
    const request=route.request(),path=new URL(request.url()).pathname
    if(path==='/')return route.fulfill({status:200,contentType:'text/html',body:html})
    if(path==='/api/status')return route.fulfill({status:200,json:{ok:true,result:{...fixture,checkedAt:new Date().toISOString(),
      browser:{available:true,open:reopened},jobs:fixture.jobs.map(job=>({...job,position:{available:true,verified:true,state:'completed'}}))}}})
    if(request.method()==='POST'){
      posts.push(path);assert.equal(path,'/api/reopen')
      if(fail)return route.fulfill({status:503,json:{ok:false,error:'Could not reopen the existing browser.'}})
      reopened=true;return route.fulfill({status:200,json:{ok:true,result:{reopened:true,preserved:true}}})
    }
    return route.fulfill({status:200,contentType:'text/html',body:'<html><body>Isolated viewer</body></html>'})
  })
  await page.goto('http://recovery-test.invalid/')
  await expect(page.locator('#browser-notice')).toContainText('Test browser is closed.')
  await page.locator('#refresh').click()
  await expect(page.locator('#refresh-feedback')).toContainText('Refresh complete.')
  assert.equal(posts.length,0)
  checks.push('Refresh checks a closed session without secretly reopening or resetting it')
  await page.getByRole('button',{name:'Reopen test browser',exact:true}).click()
  await expect(page.locator('#browser-notice')).toContainText('Test browser is open')
  assert.deepEqual(posts,['/api/reopen'])
  checks.push('Dedicated Reopen control restores the viewer and then rechecks status')
  fail=true;await page.locator('#reopen').click()
  await expect(page.locator('#browser-notice')).toContainText('Could not reopen')
  await expect(page.locator('#reopen')).toBeEnabled()
  fail=false;await page.locator('#reopen').click()
  await expect(page.locator('#browser-notice')).toContainText('Test browser is open')
  checks.push('Recovery errors leave an enabled retry without any fixture action')
  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  await expect(page.getByText('Neither starts a new test.',{exact:false})).toBeVisible()
  checks.push('Mobile controls fit and explicitly distinguish status, reopen, and a new test')
  const result={checkedAt:new Date().toISOString(),checks,passed:checks.length,realFixtureActions:0}
  console.log(JSON.stringify(result))
}finally{await browser.close()}
