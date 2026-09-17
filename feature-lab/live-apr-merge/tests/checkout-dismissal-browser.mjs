import { chromium, expect } from '@playwright/test'
import assert from 'node:assert/strict'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Real compiled React modal and native Web Locks, using only disposable local
 * database/EVM fixtures. Dismissal never waits for the held wallet prompt. */
const frontend=process.cwd(),backend=resolve(process.env.SAFFRON_BACKEND_SOURCE||'../../liquidity-incentives')
const dist=resolve(process.env.MERGE_DIST||'dist-live'),evidence=resolve('validation/checkout-dismissal')
const marker=JSON.parse(await readFile(resolve(dist,'deployment-mode.json'),'utf8'))
const {setup}=await import(pathToFileURL(resolve(backend,'tests/browser/fixture.mjs')).href)
process.env.DIST_DIR=dist;process.chdir(backend);await mkdir(evidence,{recursive:true})
const browser=await chromium.launch({headless:true}),results=[]
try{
  for(const [id,dismiss]of [['FE-PAY-014','Close'],['FE-PAY-015','Escape'],['FE-PAY-016','overlay'],['FE-PAY-017','route']]){
    const context=await browser.newContext(),page=await context.newPage(),errors=[]
    let fixture
    page.on('pageerror',error=>errors.push(error.message))
    try{
      fixture=await setup(page,{basePath:marker.basePath.replace(/\/$/,'')})
      await page.goto(fixture.origin+'/')
      // Stall the provider actually selected by this test, not the fixture's
      // different default Uniswap provider while modifying window.ethereum.
      await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click()
      await page.getByRole('button',{name:'MetaMask',exact:true}).click()
      let quotes=0
      page.on('request',request=>{if(request.url().endsWith('/deployment-quotes'))quotes++})
      await page.evaluate(()=>{
        const original=window.ethereum.request.bind(window.ethereum)
        window.pendingSwitch=[];window.holdPreparation=true
        window.ethereum.request=args=>{
          if(window.holdPreparation&&args.method==='eth_chainId')return Promise.resolve('0x1')
          if(window.holdPreparation&&args.method==='wallet_switchEthereumChain')return new Promise((resolve,reject)=>window.pendingSwitch.push({resolve,reject}))
          return original(args)
        }
      })
      await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
      await page.getByRole('button',{name:'Continue',exact:true}).click()
      await expect.poll(()=>page.evaluate(()=>window.pendingSwitch.length)).toBe(1)
      const locks=()=>page.evaluate(async()=>(await navigator.locks.query()).held.filter(row=>row.name.startsWith('saffron.wallet-action:')).length)
      assert.equal(await locks(),1)
      if(dismiss==='Close')await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
      else if(dismiss==='Escape')await page.keyboard.press('Escape')
      else if(dismiss==='overlay')await page.locator('.ReactModal__Overlay').click({position:{x:3,y:3}})
      else await page.evaluate(()=>{history.pushState({},'',location.pathname.replace(/\/$/,'')+'/status');dispatchEvent(new PopStateEvent('popstate'))})
      await expect(page.locator('[data-incentive-modal]')).toHaveCount(0)
      await expect.poll(locks).toBe(0)
      // Resolve the already-issued provider prompt after dismissal. It cannot
      // create a quote, reacquire a lock or request a transaction afterward.
      await page.evaluate(()=>{window.holdPreparation=false;window.pendingSwitch.splice(0).forEach(held=>held.resolve(null))})
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))
      assert.equal(quotes,0);assert.equal(fixture.state.sends,0);assert.equal(await locks(),0);assert.deepEqual(errors,[])
      results.push({id,dismiss,passed:true,quotes:0,sends:0,locks:0})
    }catch(error){await page.screenshot({path:resolve(evidence,id+'-failure.png')});throw error}
    finally{await context.close();await fixture?.close()}
  }
  await writeFile(resolve(evidence,'report.json'),JSON.stringify({ok:true,results,frontend,dist},null,2)+'\n')
  console.log(JSON.stringify({ok:true,results}))
}finally{await browser.close()}
