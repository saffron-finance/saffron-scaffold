import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import {pathToFileURL} from 'node:url'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { fixtureTransport } from './fixture-transport.mjs'

/** Layout and wallet gating use the canonical API, PostgreSQL, local contracts
 * and a generated wallet. Only read-only APR observations use wire fixtures. */
const frontend=process.cwd(),backend=process.env.SAFFRON_BACKEND_SOURCE
assert(backend,'Set SAFFRON_BACKEND_SOURCE and the disposable SAFFRON_TEST_DB_* connection')
const output=path.resolve(process.env.MERGE_EVIDENCE||'validation/browser')
process.env.DIST_DIR=path.resolve(process.env.MERGE_WEBROOT||'dist')
const {setup,connect}=await import(pathToFileURL(path.resolve(backend,'tests/browser/fixture.mjs')).href)
const wire=JSON.parse(await readFile(new URL('./fixtures/apr-wire.json',import.meta.url)))
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write']})
await context.addInitScript(fixtureTransport,wire)
const page=await context.newPage();page.setDefaultTimeout(20000)
const report={ok:false,checks:[],layouts:[],pngs:[],errors:[],requests:[]}
page.on('pageerror',error=>report.errors.push(error.message))
page.on('request',request=>report.requests.push(new URL(request.url()).pathname))
const nav=()=>page.getByRole('navigation',{name:page.viewportSize().width<=599?'Mobile navigation':'Main navigation',exact:true})
const stats=()=>page.evaluate(()=>window.__aprFixture.stats())
let fixture,heartbeat,origin;const base='/'
/** Decode actual copied pixels. Capture must not depend on the shell's bounds. */
async function png(label,name='NVDA / USDG 0.05%'){
  await page.getByRole('button',{name:`Copy ${name} as PNG`,exact:true}).click()
  await page.getByText('PNG copied',{exact:true}).waitFor()
  const image=await page.evaluate(async()=>{
    const [item]=await navigator.clipboard.read(),blob=await item.getType('image/png'),bitmap=await createImageBitmap(blob)
    const canvas=document.createElement('canvas');canvas.width=bitmap.width;canvas.height=bitmap.height
    const ctx=canvas.getContext('2d');ctx.drawImage(bitmap,0,0)
    const pixels=ctx.getImageData(0,0,bitmap.width,bitmap.height).data
    let visible=0;for(let i=0;i<pixels.length;i+=4)if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>80)visible++
    return {width:bitmap.width,height:bitmap.height,visible,bytes:Array.from(new Uint8Array(await blob.arrayBuffer()))}
  })
  assert.equal(image.width,1200);assert(image.height>350&&image.height<1100);assert(image.visible>8000)
  await writeFile(path.join(output,`${label}.png`),Buffer.from(image.bytes));delete image.bytes
  report.pngs.push({label,...image})
}
/** Open the host menu and follow a real internal router link. */
async function menuLink(name){
  await page.getByRole('button',{name:/^(Open menu|More)$/}).click()
  await page.getByRole('dialog').getByRole('link',{name,exact:true}).click()
}

/** Compare rendered text paint while ensuring the sidebar label inherits its
 * original navigation typography rather than the APR metric's font settings. */
async function checkAprNavigation(target){
  // Route changes load the offer catalog asynchronously before metrics exist.
  await expect(target.locator('[data-incentive-programs] [data-incentive-apr]').first()).toBeVisible()
  const result=await target.evaluate(()=>{
    const label=document.querySelector('[data-saffron-sidebar] [data-apr-navigation]')
    const value=document.querySelector('[data-incentive-programs] [data-incentive-apr]')
    const read=(el,keys)=>Object.fromEntries(keys.map(key=>[key,getComputedStyle(el)[key]]))
    const fonts=['fontFamily','fontSize','fontWeight','fontStyle','letterSpacing','lineHeight']
    const paint=['backgroundImage','backgroundSize','animationName','animationDuration','animationTimingFunction','filter']
    return {font:read(label,fonts),parentFont:read(label.parentElement,fonts),nav:read(label,paint),apr:read(value,paint),clip:getComputedStyle(label).backgroundClip}
  })
  assert.deepEqual(result.font,result.parentFont,'Live APR preserves navigation typography')
  assert.equal(result.font.fontSize,'14px');assert.equal(result.font.fontWeight,'500')
  assert.deepEqual(result.nav,result.apr,'Live APR uses the column APR paint/motion')
  assert.match(result.nav.backgroundImage,/gradient\(/,'APR paint retains its gradient')
  assert.ok(result.clip.split(',').every(value=>value.trim()==='text'),'Every APR paint layer clips to text')
}

/** Header chrome must match the real row, including its settled hover paint.
 * This checks the network indicator too without inventing selection behavior. */
async function checkHeaderControls(target){
  const row=target.locator('[data-incentive-offer]').first()
  const controls=target.locator('header[aria-label="Account controls"] > div > *')
  const read=el=>{const style=getComputedStyle(el);return Object.fromEntries(['backgroundColor','backgroundImage','borderTopColor','borderTopWidth','borderTopStyle','borderRadius','transitionProperty','transitionDuration','transitionTimingFunction'].map(key=>[key,style[key]]))}
  await target.getByRole('heading',{name:'Liquidity Incentives',exact:true}).hover()
  await expect.poll(()=>row.evaluate(el=>getComputedStyle(el).borderTopColor)).toBe('rgb(29, 29, 29)')
  const idle=await row.evaluate(read)
  assert.equal(idle.backgroundColor,'rgb(10, 10, 10)')
  await expect(controls).toHaveCount(3)
  // Resizing can move a control under the pointer before the heading hover.
  // Wait for its 160ms hover-exit transition instead of sampling an in-between color.
  for(const control of await controls.all())await expect.poll(async()=>JSON.stringify(await control.evaluate(read))).toBe(JSON.stringify(idle))
  const font=await controls.first().evaluate(el=>{const s=getComputedStyle(el);return {family:s.fontFamily,size:s.fontSize,weight:s.fontWeight}})
  assert.deepEqual(font,{family:'"Funnel Display", ui-monospace, monospace',size:'14px',weight:'500'})
  await row.hover()
  await expect.poll(()=>row.evaluate(el=>getComputedStyle(el).borderTopColor)).toBe('rgb(255, 188, 9)')
  const hover=await row.evaluate(read)
  for(const [index,control] of (await controls.all()).entries()){
    await control.hover()
    await expect.poll(async()=>JSON.stringify(await control.evaluate(read))).toBe(JSON.stringify(hover))
    await target.screenshot({path:path.join(output,`header-hover-${target.viewportSize().width}-${index}.png`),fullPage:true})
  }
  await target.getByRole('heading',{name:'Liquidity Incentives',exact:true}).hover()
}

/** Selection removes only APR paint, leaving the label's own typography intact. */
async function checkActiveAprNavigation(target){
  const label=target.locator('[data-saffron-sidebar] [aria-current="page"] [data-apr-navigation]')
  await expect(label).toHaveText('Live APR')
  const result=await label.evaluate(el=>{
    const s=getComputedStyle(el),parent=getComputedStyle(el.parentElement)
    return {color:s.color,fill:s.webkitTextFillColor,image:s.backgroundImage,animation:s.animationName,filter:s.filter,font:s.font,parentFont:parent.font}
  })
  assert.equal(result.color,'rgb(255, 255, 255)');assert.equal(result.fill,result.color)
  assert.equal(result.image,'none');assert.equal(result.animation,'none');assert.equal(result.filter,'none')
  assert.equal(result.font,result.parentFont,'Active APR changes paint only')
}

/** Portals must receive the same selected paint as the rail, including saved
 * presets. Do not compare fonts: primary actions keep their existing type. */
async function checkModalSurface(target){
  // A just-selected navigation item has a 150ms border/glow transition.
  // Compare its settled paint, not a frame partway through that transition.
  await expect.poll(async()=>{
    const result=await target.evaluate(()=>{
    const read=el=>{const style=getComputedStyle(el);return Object.fromEntries(['backgroundImage','backgroundColor','backgroundSize','animationName','animationDuration','borderTopColor','borderRadius','boxShadow'].map(key=>[key,style[key]]))}
    return {nav:read(document.querySelector('[data-saffron-sidebar] [aria-current="page"]')),action:read(document.querySelector('[data-incentive-primary-action]'))}
    })
    return JSON.stringify(result.action)===JSON.stringify(result.nav)
  },{message:'Modal primary action matches the settled selected sidebar surface',timeout:3000}).toBe(true)
}
try {
  await mkdir(output,{recursive:true});process.chdir(backend)
  fixture=await setup(page,{campaign:true,admin:true})
  origin=fixture.origin
  await fixture.database.execution.heartbeat(fixture.chain.account.address)
  heartbeat=setInterval(()=>void fixture.database.execution.heartbeat(fixture.chain.account.address).catch(()=>{}),5000)
  for(const days of [5,7])await fixture.operatorCall('/admin/campaigns',{id:'cashcat-'+days+'d',name:'Local test '+days,pairId:'cashcat-eth',days,budgetUsd:'1000',capacityUsd:'100000',requestFeeWei:'1234567890123456',active:true})
  await page.goto(origin+base)
  await expect(page.locator('[data-incentive-offer]')).toHaveCount(3)
  await expect(page.getByText(/Sample data|Payments are simulated|Reset preview/)).toHaveCount(0)
  assert.equal((await stats()).admissions,0)
  assert.equal(fixture.state.sends,0);assert.equal(fixture.state.connected,false)
  // Old preview storage cannot give the user an account or operator permission.
  await page.evaluate(()=>localStorage.setItem('saffron.live-apr-merge.campaign-preview.v1',JSON.stringify({account:'0x'+'1'.repeat(40),operator:true})))
  await page.reload();await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  await page.getByRole('dialog').getByRole('button',{name:'Connect wallet',exact:true}).click()
  await expect(page.getByRole('button',{name:'Uniswap Extension',exact:true})).toBeVisible()
  assert.equal((await fixture.database.query('SELECT count(*)::int AS n FROM saffron_incentives.deployment_quotes')).rows[0].n,0)
  await page.getByRole('button',{name:'Uniswap Extension',exact:true}).click()
  await expect(page.getByRole('button',{name:'Continue',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
  report.checks.push('Actual wallet connection is required; old sample storage cannot connect or create quotes')
  await checkAprNavigation(page)
  for(const width of [640,800,1440]){await page.setViewportSize({width,height:1100});await checkHeaderControls(page)}
  await page.evaluate(()=>document.fonts.ready)
  for(const width of [320,390,430,599,600,640,800,1001,1440,1600]){
    await page.setViewportSize({width,height:844})
    for(const collapsed of width<600?[false]:[false,true]){
      if(collapsed)await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Home overflow '+width)
      const geometry=await page.locator('[data-incentive-offer]').evaluateAll(rows=>rows.map(row=>({
        duration:getComputedStyle(row.querySelector('[data-incentive-duration]')).font,
        tvl:getComputedStyle(row.querySelector('[data-incentive-tvl]')).font,
        capacity:row.querySelectorAll('[data-incentive-capacity], [data-incentive-utilization]').length,
      })))
      assert(geometry.every(row=>row.duration===row.tvl&&row.capacity===0))
      report.layouts.push({width,collapsed,geometry})
      if(collapsed)await page.getByRole('button',{name:'Open sidebar',exact:true}).click()
    }
    if([320,390,1440].includes(width))await page.screenshot({path:path.join(output,'home-'+width+'.png'),fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1100})
  // Preserve approved portal paint and exact fee disclosure without ever
  // bypassing wallet review. Reset withdraws only an unpaid quote.
  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  await checkModalSurface(page)
  await expect(page.getByRole('dialog')).toContainText('Request fee: 0.001 ETH')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Claim $1.00',exact:true})).toBeVisible()
  await checkModalSurface(page)
  await expect(page.getByRole('dialog')).toContainText('Request fee: 0.001 ETH')
  assert.equal(fixture.state.sends,0)
  await page.getByRole('button',{name:'← Back',exact:true}).click()
  await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
  report.checks.push('Ten responsive widths, shared header/portal paint and exact pre-quote/review ETH fee')
  await menuLink('Campaigns')
  await expect(page.getByLabel('Campaign request fee ETH')).toHaveValue('')
  await page.getByLabel('Campaign ID',{exact:true}).fill('wallet-fee-test')
  await page.getByLabel('Campaign name',{exact:true}).fill('Wallet fee test')
  await page.getByLabel('Campaign request fee ETH').fill('0.0000000000000000001')
  await page.getByRole('button',{name:'Create campaign',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('at most 18 decimal places')
  await page.getByLabel('Campaign request fee ETH').fill('0.000000000000000007')
  await page.getByRole('button',{name:'Create campaign',exact:true}).click()
  await expect(page.getByText('Campaign configuration saved.',{exact:true})).toBeVisible()
  await expect(page.getByLabel('Request fee ETH for wallet-fee-test')).toHaveValue('0.000000000000000007')
  await page.getByLabel('Request fee ETH for wallet-fee-test').fill('0.123456789012345678')
  await page.getByRole('form',{name:'Request fee for wallet-fee-test',exact:true}).getByRole('button',{name:'Save request fee',exact:true}).click()
  await expect.poll(async()=>(await fixture.database.catalog(true)).programs.find(p=>p.id==='wallet-fee-test').requestFeeWei).toBe('123456789012345678')
  assert(fixture.state.signs>0,'Operator changes require a real wallet signature')
  await page.reload();await expect(page.getByLabel('Request fee ETH for wallet-fee-test')).toHaveValue('0.123456789012345678')
  report.checks.push('Wallet-authenticated campaign creation/editing: exact wei, persistence, missing input and overprecision rejection')
  await nav().getByRole('link',{name:'Live APR',exact:true}).click()
  await expect(page.getByTestId('pool-pair-name')).toHaveText('NVDA / USDG 0.05%')
  await checkActiveAprNavigation(page)
  await page.getByRole('button',{name:'Tokens',exact:true}).click()
  await page.getByRole('searchbox').fill('NVDA USDG 0.05')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem',{name:'NVDA / USDG 0.05%',exact:true})).toBeFocused()
  await page.keyboard.press('Escape')
  await png('apr-single')
  await page.getByRole('button',{name:'Swaps since you opened this page',exact:true}).click()
  await page.waitForFunction(()=>window.__aprFixture.stats().histories>0)
  for(const width of [320,390,800,1440]){
    await page.setViewportSize({width,height:844})
    assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'APR overflow '+width)
  }
  report.checks.push('Read-only APR, keyboard filtered menu, real clipboard PNG pixels, history and responsive layout')
  await page.goto(origin+'/?view=campaigns&keep=1#example')
  await page.waitForURL('**/campaigns?keep=1#example')
  for(const route of ['stats','community','unknown']){
    await page.goto(origin+'/'+route);await page.reload()
    await expect(page.locator('main h1')).toHaveText(route==='unknown'?'Page not found':route==='stats'?'Stats':'Community')
  }
  assert.equal(fixture.state.sends,0,'Layout/fee configuration tests never pay automatically')
  assert.deepEqual(report.errors,[]);report.ok=true;report.wallet='Generated wallet on disposable EVM';report.apr='Read-only wire fixture'
  await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({...report,requests:report.requests.length}))
}catch(error){
  report.failure=String(error);await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n')
  await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw error
}finally{clearInterval(heartbeat);await browser.close();if(fixture)await fixture.close()}
