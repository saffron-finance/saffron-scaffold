import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
const require=createRequire(new URL('../live-apr-merge/package.json',import.meta.url))
const {chromium,expect}=require('@playwright/test')

/** Verify the actual offline deliverable and the interaction it promises. The
 * file is served locally; all other HTTP requests are blocked and recorded. */
const file=resolve('saffron-mobile-design-2026-09-12.html'),output=resolve('validation')
await mkdir(output,{recursive:true})
const bytes=await readFile(file),server=createServer((req,res)=>{res.setHeader('Content-Type','text/html');if(req.url==='/favicon.ico'){res.writeHead(204);res.end();return}res.end(bytes)})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({headless:true}),context=await browser.newContext({viewport:{width:1440,height:1100}})
const errors=[],unexpected=[],checks=[]
await context.route('**/*',route=>{const url=route.request().url();if(!url.startsWith(origin)&&!url.startsWith('data:')&&!url.startsWith('about:')){unexpected.push(url);return route.abort()}return route.continue()})
const page=await context.newPage();page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message))
let ok=false
try{
 await page.goto(origin);await expect(page.locator('details.section')).toHaveCount(10);await expect(page.locator('iframe')).toHaveCount(13)
 const frame=page.frameLocator('#mobile-prototype')
 await expect(frame.getByRole('heading',{name:'Liquidity incentives',exact:true})).toBeVisible()
 await page.locator('#mobile-prototype').scrollIntoViewIfNeeded()
 await page.locator('#main-device').screenshot({path:resolve(output,'prototype-home.png')})
 await page.screenshot({path:resolve(output,'desktop-overview.png'),fullPage:true})
 // Build the exact request/review/progress interaction shown in the main frame.
 await frame.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
 await frame.getByLabel('Deposit value in US dollars',{exact:true}).fill('200')
 await frame.getByRole('button',{name:'Continue',exact:true}).click()
 await expect(frame.getByRole('heading',{name:'Claim $2.00',exact:true})).toBeVisible()
 await page.locator('#main-device').screenshot({path:resolve(output,'prototype-review.png')})
 await frame.getByRole('button',{name:'Back',exact:true}).click()
 await expect(frame.getByLabel('Deposit value in US dollars',{exact:true})).toHaveValue('200')
 await frame.getByRole('button',{name:'Continue',exact:true}).click()
 await frame.getByRole('button',{name:'Claim $2.00',exact:true}).click()
 await expect(frame.getByText('Awaiting campaign funding',{exact:true})).toBeVisible()
 await frame.getByRole('button',{name:'Close dialog',exact:true}).click()
 await expect(frame.getByRole('heading',{name:'Portfolio',exact:true})).toBeVisible()
 checks.push('Amount → Back-preserved review → simulated request → C06 → Portfolio works without wallet/API access')
 // The LP action chain stays explicit, even in this inert design prototype.
 await page.locator('#prototype-scene').selectOption('deposit')
 for(const name of ['Wrap ETH','Approve CASHCAT','Approve ETH','Deposit LP assets','Claim premium'])await frame.getByRole('button',{name,exact:true}).click()
 await expect(frame.getByRole('dialog').getByRole('heading',{name:'CASHCAT / ETH',exact:true})).toBeVisible()
 await page.locator('#prototype-scene').selectOption('matured')
 await frame.getByRole('button',{name:'Withdraw LP assets',exact:true}).click()
 await expect(frame.getByRole('heading',{name:'Position completed',exact:true})).toBeVisible()
 await frame.getByRole('button',{name:'Back to Portfolio',exact:true}).click()
 checks.push('LP wrap/approvals/deposit, premium claim and mature withdrawal mockups form a complete explicit-action sequence')
 await page.locator('#prototype-state').selectOption('lost')
 await frame.getByRole('button',{name:'Check saved payment',exact:true}).click()
 await frame.getByRole('button',{name:'Check payment',exact:true}).click()
 await expect(frame.getByText('Awaiting campaign funding',{exact:true})).toBeVisible()
 await frame.getByRole('button',{name:'Close dialog',exact:true}).click()
 await page.locator('#prototype-state').selectOption('offline')
 await expect(frame.getByText(/Verification is unavailable/)).toBeVisible()
 await page.locator('#prototype-state').selectOption('admin')
 await expect(frame.getByText(/Admin only/)).toBeVisible()
 await frame.getByRole('button',{name:'Home',exact:true}).click()
 await expect(frame.getByText(/Admin only/)).toHaveCount(0)
 checks.push('Recovery, offline and admin-only Portfolio scenarios work; the advisory is absent on Home')
 await frame.getByRole('button',{name:'Live APR',exact:true}).click()
 for(let i=0;i<3;i++)await frame.getByRole('button',{name:'+ Compare a pool',exact:true}).click()
 await expect(frame.getByRole('button',{name:'Three comparisons added',exact:true})).toBeDisabled()
 await frame.getByRole('button',{name:'Remove CASHCAT / ETH',exact:true}).click()
 await expect(frame.getByRole('button',{name:'+ Compare a pool',exact:true})).toBeEnabled()
 await frame.getByRole('button',{name:'More',exact:true}).click()
 await expect(frame.getByRole('heading',{name:'More',exact:true})).toBeVisible()
 checks.push('Bottom navigation, three comparison limit and secondary More destination work')
 await page.locator('#keyboard-demo').check()
 await expect(frame.getByLabel('Deposit value in US dollars',{exact:true})).toBeVisible()
 const keyboard=await frame.locator('body').evaluate(()=>({button:document.querySelector('.sheetfoot button').getBoundingClientRect().bottom,keyboard:innerHeight-180,dialog:document.querySelector('dialog').getBoundingClientRect().bottom}))
 expect(keyboard.button).toBeLessThanOrEqual(keyboard.keyboard);expect(keyboard.dialog).toBeLessThanOrEqual(keyboard.keyboard+1)
 await page.locator('#keyboard-demo').uncheck()
 await frame.getByRole('button',{name:'Close dialog',exact:true}).click()
 checks.push('Simulated keyboard leaves the focused field and action above reserved keyboard space')
 // Width controls change the actual isolated browsing context, not a bitmap scale.
 for(const width of ['320','390','430']){
  await page.locator('#device-width').selectOption(width)
  await page.locator('#reset-prototype').click()
  expect(await frame.locator('html').evaluate(el=>el.scrollWidth<=innerWidth)).toBe(true)
  const targets=await frame.locator('button').evaluateAll(nodes=>nodes.filter(n=>n.getClientRects().length).map(n=>n.getBoundingClientRect()))
  expect(targets.every(r=>r.width>=44&&r.height>=44)).toBe(true)
 }
 checks.push('320/390/430px frames have no horizontal overflow and visible buttons meet 44px targets')
 // Native section controls, keyboard, and deep links remain usable without an accordion.
 const summary=page.locator('#responsive > summary');await summary.focus();await page.keyboard.press('Enter');await expect(page.locator('#responsive')).toHaveAttribute('open','')
 await page.keyboard.press('Space');expect(await page.locator('#responsive').evaluate(el=>el.open)).toBe(false)
 await page.goto(origin+'/#manual-refunds');await expect(page.locator('#manual-refunds')).toHaveAttribute('open','');await expect(page.locator('#edges')).toHaveAttribute('open','')
 await page.getByRole('button',{name:'Expand all',exact:true}).click()
 // Bring lazy isolated frames into view so their real HTML is painted and checked.
 for(const element of await page.locator('iframe').all()){
  await element.scrollIntoViewIfNeeded()
  await expect(element.contentFrame().locator('h1').first()).toBeVisible()
 }
 await expect(page.frameLocator('iframe[title="Withdraw at maturity mobile mockup"]').getByRole('heading',{name:'Your LP is ready to withdraw',exact:true})).toBeVisible()
 for(const width of [320,390,768,1440]){
  await page.setViewportSize({width,height:1000})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  if(width===390)await page.screenshot({path:resolve(output,'mobile-document.png'),fullPage:true})
 }
 checks.push('Native keyboard toggles, nested deep links, all 13 HTML frames and 320/390/768/1440px document layouts pass')
 await page.setViewportSize({width:1440,height:1100})
 await page.evaluate(()=>{for(const el of document.querySelectorAll('details.section'))el.open=['experience','flow'].includes(el.id)})
 const before=await page.locator('main details').evaluateAll(nodes=>nodes.map(n=>n.open))
 await page.pdf({path:resolve(output,'print-verification.pdf'),format:'A4',printBackground:true,margin:{top:'12mm',right:'12mm',bottom:'12mm',left:'12mm'}})
 expect(await page.locator('main details').evaluateAll(nodes=>nodes.map(n=>n.open))).toEqual(before)
 checks.push('Actual PDF print expands closed plan sections and restores prior disclosure states')
 expect(errors).toEqual([]);expect(unexpected).toEqual([]);ok=true
} catch(error){await page.screenshot({path:resolve(output,'failure.png'),fullPage:true});throw error}
finally{await writeFile(resolve(output,'verification.json'),JSON.stringify({ok,checks,errors,unexpected},null,2)+'\n');await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));console.log(JSON.stringify({ok,checks,errors,unexpected}))}
