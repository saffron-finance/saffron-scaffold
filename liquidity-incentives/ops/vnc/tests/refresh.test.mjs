/** Regression checks for refresh feedback, status recovery, and position truth.
 * All browser traffic and fixture actions are intercepted; this suite cannot
 * change the existing user's chain, database, browser, wallet, or transactions.
 */
import { chromium, expect } from '@playwright/test'
import { readFile, writeFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
import { withPositionStatus } from '../qa-status.mjs'

const before={"ok": true, "result": {"environment": "Disposable local contracts; NOT mainnet", "commit": "8c912ee0c69f7db7c0fe4ba62bc5036486965647", "origin": "http://127.0.0.1:36859", "chainId": 4663, "user": "0x310A7029dA8Ea4846De91B581DF831d552Be9FFA", "treasury": "0x62CCEE49c74d264351e13eC4ec9B761F8b9e4EE0", "creator": "0xc3556175B5f5cE055bC0C1563b7ac73F7e1994b2", "busy": false, "jobs": [{"id": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "state": "created", "vault": "0x05ba59cd117a11232e9f9005d08c23a14397f106", "creation": {"state": "created", "simulationPassed": true, "upstreamBroadcasts": 0}, "funding": {"started": true, "suppliedRaw": "500000000000000250001", "capacityRaw": "500000000000000250001", "endTime": "1789413517"}}], "operations": [{"action": "create", "requestId": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "state": "created", "time": "2026-09-11T19:13:55.663Z"}, {"action": "fund", "requestId": "604e6a81-cf6b-488f-bbb7-f9abae18dff8", "amountRaw": "500000000000000250001", "transactions": [{"hash": "0x05afdf06e52c6f835c1c52a095c75317052a4ced0279cf94ba6649c3ab825267", "blockNumber": "9675", "blockHash": "0x8ccbdab389c14a02b6556d69eb668592e3af5b815b7425e8039f20f386322987"}, {"hash": "0x3a02f576e0f6772452b9197040979590e5ddb12c94cf95db4b21576d5c7db82e", "blockNumber": "9677", "blockHash": "0xea34139c9d029764734479d5ef2cf2bd108c5f80baec0ff96f85f3194f3df568"}], "time": "2026-09-11T19:18:22.641Z"}, {"action": "mature", "timestamp": 1789413519, "time": "2026-09-11T19:18:41.771Z"}, {"action": "mature", "timestamp": 1789413564, "time": "2026-09-11T19:19:25.405Z"}], "userTransactions": 7, "userMessageSignatures": 0, "creatorBroadcasts": 3, "clockAdvanced": true, "checkedAt": "2026-09-11T19:31:52.529Z"}}
const html=await readFile(new URL('../qa.html',import.meta.url),'utf8')
const checks=[]
const success=await withPositionStatus(before,{fetcher:async(url,options)=>{
  assert.equal(url.origin,before.result.origin);assert.equal(options.method,'GET');assert.equal(options.redirect,'error')
  assert.ok(options.signal)
  return {ok:true,json:async()=>({deployment:{id:before.result.jobs[0].id,positionWallet:before.result.user,state:'completed',
    canClaim:false,canWithdraw:false,depositable:false,observation:{verified:true,canonical:true,blockNumber:'10084',blockTimestamp:1789414279,claimBalance:'0',fixedBalance:'0'}}})}
}})
assert.equal(success.result.jobs[0].state,'created')
assert.equal(success.result.jobs[0].position.state,'completed')
checks.push('Worker creation and wallet completion are distinct; reads are bounded and redirect-free')
const unavailable=await withPositionStatus(before,{fetcher:async()=>{throw Error('Offline')}})
assert.equal(unavailable.result.jobs[0].position.available,false)
const mismatch=await withPositionStatus(before,{fetcher:async()=>({ok:true,json:async()=>({deployment:{id:'different'}})})})
assert.equal(mismatch.result.jobs[0].position.available,false)
checks.push('Unavailable and identity-mismatched positions remain unknown')
for(const origin of ['https://example.com','http://localhost:36859','http://127.0.0.1:36859/path','http://127.0.0.1:36859?query=1']){
  await assert.rejects(()=>withPositionStatus({...before,result:{...before.result,origin}},{fetcher:()=>{throw Error('Must not fetch')}}))
}
checks.push('Non-fixture origins are rejected before fetching')

const browser=await chromium.launch({headless:true})
try{
  const page=await browser.newPage({viewport:{width:1280,height:1000}})
  let requests=0,posts=0,mode='normal',pendingRoute=null,payload=success
  // Make the production 25-second timeout fast only in this isolated verifier.
  // The served page retains its actual bounded timeout and polling behavior.
  await page.addInitScript(()=>{
    const original=AbortSignal.timeout.bind(AbortSignal)
    AbortSignal.timeout=milliseconds=>original(milliseconds===25000?800:milliseconds)
  })
  await page.route('**/*',async route=>{
    const url=new URL(route.request().url())
    if(url.pathname==='/')return route.fulfill({status:200,contentType:'text/html',body:html})
    if(url.pathname==='/api/status'){
      requests++
      if(mode==='delay'||mode==='timeout'){pendingRoute=route;return}
      if(mode==='error')return route.fulfill({status:503,json:{ok:false,error:'Test session unavailable.'}})
      return route.fulfill({status:200,json:{...payload,result:{...payload.result,checkedAt:new Date().toISOString()}}})
    }
    if(route.request().method()!=='GET')posts++
    return route.fulfill({status:200,contentType:'text/html',body:'<html><body>Isolated verifier; no remote browser connection.</body></html>'})
  })
  await page.goto('http://refresh-test.invalid/')
  await expect(page.locator('#notice')).toHaveText('Completed — LP assets withdrawn. Your test session is preserved.')
  await expect(page.getByRole('button',{name:'Advance to maturity',exact:true})).toBeDisabled()
  await expect(page.locator('#refresh-feedback')).toContainText('Last checked')
  await expect(page.locator('#clock-note')).toBeVisible()
  checks.push('Completed position replaces stale withdrawal instructions and disables repeat maturity')

  for(let index=0;index<2;index++){
    const oldTimestamp=await page.locator('#refresh-feedback').getAttribute('data-checked-at')
    await page.getByRole('button',{name:'Refresh status',exact:true}).click()
    await expect(page.locator('#refresh-feedback')).toContainText('Refresh complete.')
    await expect(page.locator('#refresh-feedback')).not.toHaveAttribute('data-checked-at',oldTimestamp)
  }
  checks.push('Two successive clicks each confirm a fresh successful check')

  mode='delay';const requestCount=requests
  await page.getByRole('button',{name:'Refresh status',exact:true}).click()
  await expect(page.locator('#refresh')).toHaveText('Refreshing…')
  await expect(page.locator('#refresh')).toBeDisabled()
  await expect.poll(()=>Boolean(pendingRoute)).toBe(true)
  // Re-entrant clicks/polls join the same request rather than multiplying work.
  await page.evaluate(()=>{void refresh(true);void refresh()})
  assert.equal(requests,requestCount+1)
  await pendingRoute.fulfill({status:200,json:success});pendingRoute=null;mode='normal'
  await expect(page.locator('#refresh')).toBeEnabled()
  checks.push('In-flight refresh is visible, coalesces repeat requests, and restores controls')

  mode='error'
  await page.locator('#refresh').click()
  await expect(page.locator('#refresh-feedback')).toContainText('Press Refresh status to retry.')
  await expect(page.locator('#notice')).toContainText('Refresh to check the current test')
  await expect(page.locator('#refresh')).toBeEnabled()
  mode='normal';await page.locator('#refresh').click()
  await expect(page.locator('#notice')).toContainText('Completed')
  checks.push('HTTP failure is visible and the next refresh recovers')

  mode='timeout';await page.locator('#refresh').click()
  await expect(page.locator('#refresh-feedback')).toContainText('Status check timed out.')
  await expect(page.locator('#refresh')).toBeEnabled()
  await pendingRoute.abort();pendingRoute=null;mode='normal'
  await page.locator('#refresh').click()
  await expect(page.locator('#notice')).toContainText('Completed')
  checks.push('Hung request times out, unlocks refresh, and recovers on retry')

  payload=unavailable;await page.locator('#refresh').click()
  await expect(page.locator('#notice')).toContainText('Position status unavailable.')
  await expect(page.getByRole('button',{name:'Advance to maturity',exact:true})).toBeDisabled()
  checks.push('Missing canonical position never displays false completion or enables maturity')

  const active=structuredClone(success);active.result.clockAdvanced=false
  active.result.jobs[0].position.state='active';payload=active
  await page.locator('#refresh').click()
  await expect(page.locator('#notice')).toContainText('Position active')
  await expect(page.getByRole('button',{name:'Advance to maturity',exact:true})).toBeEnabled()
  payload={ok:true,result:{...success.result,jobs:[],clockAdvanced:false}}
  await page.locator('#refresh').click()
  await expect(page.locator('#notice')).toContainText('Create your first test request')
  await expect(page.locator('#clock-note')).toBeHidden()
  checks.push('Active and empty sessions retain the correct next steps')

  await page.setViewportSize({width:390,height:844})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.equal(posts,0)
  checks.push('Mobile layout fits and all refresh checks issue zero state-changing requests')
  const result={checkedAt:new Date().toISOString(),checks,passed:checks.length,fixtureActions:0}
  console.log(JSON.stringify(result))
}finally{await browser.close()}
