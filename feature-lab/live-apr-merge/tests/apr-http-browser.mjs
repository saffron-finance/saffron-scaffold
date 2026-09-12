import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile,mkdir,writeFile } from 'node:fs/promises'
import { resolve,extname,sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { chromium,expect as baseExpect } from '@playwright/test'

// A controlled HTTP/SSE gateway contract fixture, not a production gateway.
// Browser fetch, streaming, cookies, session headers and cancellation are real.
const expect=baseExpect.configure({timeout:20000}),root=resolve(process.env.MERGE_WEBROOT||'dist-live')
const wire=JSON.parse(await readFile(new URL('./fixtures/apr-wire.json',import.meta.url)))
const shift=(v,d)=>Array.isArray(v)?v.map(x=>shift(x,d)):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,shift(x,d)])):typeof v==='number'&&v>1e12?v+d:v
const receipts=new Map(),streams=new Map(),sockets=new Set(),errors=[]
const stats={admissions:0,attempts:0,resumes:0,histories:0,renewals:0,releases:0,authenticated:0}
let outage=false,loseFirst=true,unknownResume=false
const json=(res,data,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(data))}
const event=(res,name,data)=>res.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost'),prefix='/api/live-apr/v2'
    if(url.pathname.startsWith(prefix)){
      const path=url.pathname.slice(prefix.length)
      if(outage)return json(res,{code:'service_unavailable'},503)
      let text='';for await(const chunk of req){text+=chunk;if(text.length>8192)return json(res,{},413)}
      const body=text?JSON.parse(text):{}
      if(path==='/sessions'&&req.method==='POST'){
        stats.attempts++
        let saved=receipts.get(body.loadId)
        if(!saved){
          const now=Date.now(),fixture=shift(wire,now-wire.now),sessionId=randomUUID()
          saved={first:{...fixture.first,poolId:body.poolId},receipt:{...body,sessionId,acceptedAtMs:now-31000,joinAtMs:now-31000,loadDeadlineMs:fixture.control.loadDeadlineMs,baseline:{...fixture.baseline,poolId:body.poolId},watcher:fixture.first.watcher,serverTimeMs:now}}
          receipts.set(body.loadId,saved);stats.admissions++
        }
        res.setHeader('set-cookie','apr-contract=present; Path=/; HttpOnly; SameSite=Strict')
        if(loseFirst){loseFirst=false;return json(res,{code:'response_lost'},503)}
        return json(res,saved.receipt)
      }
      assert.match(req.headers.cookie||'',/apr-contract=present/)
      stats.authenticated++
      if(path==='/sessions/resume'&&req.method==='POST'){
        stats.resumes++
        const saved=receipts.get(body.loadId)
        if(unknownResume||saved?.receipt.sessionId!==body.sessionId)return json(res,{code:'paused_requires_reload'},409)
        return json(res,saved.receipt)
      }
      if(req.method==='DELETE'){stats.releases++;return json(res,{released:true})}
      if(path.endsWith('/renew')){stats.renewals++;return json(res,{watcher:shift(wire,Date.now()-wire.now).first.watcher,serverTimeMs:Date.now()})}
      const sessionId=req.headers['x-session-id'],saved=[...receipts.values()].find(x=>x.receipt.sessionId===sessionId)
      assert(saved,'stream/history require the existing session header')
      assert(path.includes('/'+saved.receipt.poolId+'/'),'pool and session must match')
      if(path.endsWith('/history')){stats.histories++;return json(res,{rows:[],nextCursor:null,retainedFromMs:null,epoch:saved.first.epoch})}
      if(path.endsWith('/events')){
        res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'})
        streams.set(sessionId,res);event(res,'snapshot',saved.first)
        const heartbeat=setInterval(()=>event(res,'status',{serverTimeMs:Date.now()}),1000)
        res.on('close',()=>{clearInterval(heartbeat);if(streams.get(sessionId)===res)streams.delete(sessionId)})
        return
      }
      return json(res,{},404)
    }
    if(url.pathname.startsWith('/api/'))return json(res,{error:'No incentives fixture on this gateway server.'},503)
    const file=resolve(root,extname(url.pathname)?'.'+decodeURIComponent(url.pathname):'index.html')
    assert(file.startsWith(root+sep))
    res.setHeader('content-type',({'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.jpg':'image/jpeg'})[extname(file)]||'application/octet-stream')
    res.end(await readFile(file))
  }catch(error){errors.push(String(error));if(!res.headersSent)res.writeHead(500);res.end()}
})
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin='http://127.0.0.1:'+server.address().port,browser=await chromium.launch({headless:true})
const page=await browser.newPage({viewport:{width:1440,height:1000}}),report={ok:false,kind:'controlled-http-contract',gatewayVersion:2,route:'/api/live-apr/v2',liveGatewayQualified:false}
page.on('pageerror',error=>errors.push(error.message));page.setDefaultTimeout(20000)
try{
  await page.goto(origin+'/live-apr/cashcat-eth-1?compare=zzz-eth-1')
  await expect.poll(()=>streams.size).toBe(2)
  await expect(page.getByTestId('pool-tvl').first()).not.toContainText('Unavailable')
  assert.equal(stats.admissions,2);assert.equal(stats.attempts,3)
  const identities=[...receipts.values()].map(x=>[x.receipt.sessionId,x.receipt.baseline.baselineId])
  const expand=page.getByRole('button',{name:/^Expand .* details$/})
  if(await expand.count())await expand.first().click()
  await page.getByTestId('swap-history-toggle').first().click()
  await expect.poll(()=>stats.histories).toBe(1)
  await expect.poll(()=>stats.renewals,{timeout:35000}).toBeGreaterThanOrEqual(2)
  assert.equal(stats.admissions,2,'presence renewal is not a new observation admission')
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pagehide',{persisted:true})))
  await expect.poll(()=>streams.size).toBe(0)
  await page.evaluate(()=>window.dispatchEvent(new PageTransitionEvent('pageshow',{persisted:true})))
  await expect.poll(()=>streams.size).toBe(2)
  assert.equal(stats.admissions,2);assert(stats.resumes>=2)
  outage=true;for(const res of streams.values())res.end()
  await expect(page.getByTestId('live-apr').first()).toHaveText('APR unavailable')
  await expect(page.getByTestId('data-stale').first()).toBeVisible()
  outage=false
  await expect.poll(()=>streams.size).toBe(2)
  await expect(page.getByTestId('live-apr').first()).not.toHaveText('APR unavailable')
  assert.deepEqual([...receipts.values()].map(x=>[x.receipt.sessionId,x.receipt.baseline.baselineId]),identities)
  unknownResume=true;for(const res of streams.values())res.end()
  await expect(page.getByRole('button',{name:'Refresh page',exact:true}).first()).toBeVisible()
  assert.equal(stats.admissions,2,'failed resume must not create a replacement admission')
  await page.getByRole('link',{name:'Home',exact:true}).click()
  await expect.poll(()=>streams.size).toBe(0)
  await expect.poll(()=>stats.releases).toBe(2)
  assert.deepEqual(errors,[]);report.ok=true
}finally{
  await mkdir('validation/apr-http',{recursive:true})
  await writeFile('validation/apr-http/verification.json',JSON.stringify({...report,stats,errors},null,2)+'\n')
  await browser.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r))
  console.log(JSON.stringify({...report,stats,errors}))
}
