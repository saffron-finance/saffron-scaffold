import { chromium } from '@playwright/test'
import { createInterface } from 'node:readline'
import { setup } from './browser/fixture.mjs'

// Explicit local demo command. The production app never imports this module.
// All keys, chain state and seeded budgets belong to this disposable fixture.
const smoke=process.argv.includes('--smoke')
let browser,fixture,timer,input,running=false,stopping=false,inflight=Promise.resolve()
try{
  browser=await chromium.launch({headless:smoke})
  const page=await browser.newPage({viewport:{width:1440,height:1000}})
  fixture=await setup(page,{admin:true,wrap:true})
  await page.goto(fixture.origin)
  await page.locator('[data-incentive-offer]').first().waitFor()
  console.log('Disposable incentives demo: '+fixture.origin)
  if(smoke){
    if(await page.locator('[data-incentive-offer]').count()!==4)throw new Error('Seeded catalog unavailable')
    console.log('Production UI, API, PostgreSQL and local protocol are ready.')
  }else{
    console.log('Use Connect wallet → Uniswap Extension. This generated wallet is also the demo operator.')
    console.log('Pay $2 in test ETH; creation runs automatically. Type fund here to simulate external treasury deposits.')
    console.log('Return to My vaults to deposit and claim. Type mature here to advance the local chain, or quit to stop and remove the fixture.')
    const tick=()=>{
      if(running||stopping)return
      running=true
      inflight=fixture.worker.tick().catch(()=>console.error('Local worker retry pending; inspect Administration.')).finally(()=>{running=false})
    }
    timer=setInterval(tick,1000);tick()
    await new Promise(resolve=>{
      const stop=()=>{stopping=true;resolve()}
      process.once('SIGINT',stop);process.once('SIGTERM',stop);browser.once('disconnected',stop)
      input=createInterface({input:process.stdin,output:process.stdout})
      let advancing=false
      input.on('line',async line=>{
        if(line.trim()==='quit'){stop();return}
        if(line.trim()==='fund'&&!advancing){
          advancing=true
          try{const {jobs}=await fixture.database.list({admin:true});for(const row of jobs)if(row.state==='created'&&row.plan.vault)await fixture.chain.fund(row);console.log('External test treasury funding submitted.')}catch{console.error('Test funding failed; inspect the vault state.')}finally{advancing=false}
          return
        }
        if(line.trim()!=='mature'||advancing)return
        advancing=true
        try{
          const {jobs:rows}=await fixture.database.list({admin:true})
          const snapshots=await Promise.all(rows.map(row=>fixture.database.execution.observation(row.id)))
          const ends=snapshots.filter(s=>s?.verified&&s.isStarted).map(s=>Number(s.endTime))
          if(!ends.length){console.log('No started local vault yet. Deposit and claim first.');return}
          const head=await fixture.chain.raw('eth_getBlockByNumber',['latest',false])
          await fixture.advanceTo(Math.max(...ends,Number(BigInt(head.timestamp)))+2)
          console.log('Local vaults have matured. Withdraw through the connected wallet.')
        }catch{console.error('Local time advance failed; inspect the demo before retrying.')}
        finally{advancing=false}
      })
      input.once('close',stop)
    })
  }
}catch(error){
  console.error('Demo setup failed. Check the documented disposable PostgreSQL role, Chromium installation and built UI.')
  process.exitCode=1
}finally{
  stopping=true;clearInterval(timer);input?.close();await inflight
  await browser?.close();await fixture?.close()
}
