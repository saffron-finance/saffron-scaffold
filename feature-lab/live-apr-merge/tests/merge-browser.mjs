import { createServer } from 'node:http'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { fixtureTransport } from './fixture-transport.mjs'
import { checkMobileHome } from './mobile-home-checks.mjs'

const root=path.resolve(process.env.MERGE_WEBROOT || 'dist')
const output=path.resolve(process.env.MERGE_EVIDENCE || 'validation/browser')
const base=process.env.MERGE_BASE ?? '/saffron/apps/feature-lab/live-apr-merge/'
const wire=JSON.parse(await readFile(new URL('./fixtures/apr-wire.json',import.meta.url)))
const mime={'.html':'text/html','.js':'text/javascript','.json':'application/json','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.ico':'image/x-icon','.woff2':'font/woff2','.ttf':'font/ttf','.glb':'model/gltf-binary'}
const sockets=new Set()
const server=createServer(async(req,res)=>{
  try {
    const url=new URL(req.url,'http://localhost')
    assert(url.pathname.startsWith(base))
    let relative=url.pathname.slice(base.length)
    if (!relative || !path.extname(relative)) relative='index.html'
    const file=path.resolve(root,relative);assert(file.startsWith(root+path.sep))
    res.setHeader('content-type',mime[path.extname(file)]||'application/octet-stream')
    res.end(await readFile(file))
  } catch {res.writeHead(404);res.end()}
})
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
const origin=`http://127.0.0.1:${server.address().port}`
const browser=await chromium.launch({headless:true})
const context=await browser.newContext({viewport:{width:1440,height:1100},permissions:['clipboard-read','clipboard-write']})
await context.addInitScript(fixtureTransport,wire)
await context.addInitScript(()=>localStorage.setItem('saffron.campaign-ui-preview.v1','original-preview-sentinel'))
const report={ok:false,checks:[],layouts:[],pngs:[],errors:[],unexpected:[],requests:[]}
await context.route('**/*',route=>{
  const url=new URL(route.request().url())
  report.requests.push(url.pathname)
  if(url.origin!==origin||/\/(api|rpc|prices)\//.test(url.pathname)){
    report.unexpected.push(url.pathname);return route.abort()
  }
  return route.continue()
})
const page=await context.newPage()
page.setDefaultTimeout(10000)
page.on('pageerror',e=>report.errors.push(e.message))
page.on('console',message=>{if(message.type()==='error'||message.text().startsWith('APR PNG capture failed')) report.errors.push(message.text())})
const nav=()=>page.getByRole('navigation',{name:page.viewportSize().width<=599?'Mobile navigation':'Main navigation',exact:true})
const stats=()=>page.evaluate(()=>window.__aprFixture.stats())
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
  await mkdir(output,{recursive:true})
  await page.goto(origin+base)
  await expect(page.locator('[data-incentive-offer]')).toHaveCount(3)
  await expect(page.locator('[data-incentive-tvl]')).toHaveText(['$500,000','$700,000','$900,000'])
  await expect(page.locator('[data-incentive-capacity], [data-incentive-utilization]')).toHaveCount(0)
  await expect(page.getByText(/near capacity|capacity remaining/i)).toHaveCount(0)
  await expect(nav().getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','page')
  assert.deepEqual(await nav().getByRole('link').allTextContents(),['Home','Portfolio','Saffron pro','Live APR','Stats','Audits','Community'])
  await checkAprNavigation(page)
  for(const width of [640,800,1440]){
    await page.setViewportSize({width,height:1100})
    await checkHeaderControls(page)
  }
  report.checks.push('Unchanged tablet/desktop header surface, border, gold hover and CONNECT font at 640/800/1440px')
  await checkMobileHome({browser,origin,base,output,report,wire})
  await expect(nav().getByRole('link',{name:'Saffron pro',exact:true})).toHaveAttribute('href','https://app.saffron.finance/')
  await expect(nav().getByRole('link',{name:'Saffron pro',exact:true})).toHaveAttribute('target','_blank')
  assert.equal(await page.getByText('UI preview · sample campaigns · no transactions',{exact:true}).count(),0)
  assert.equal(await page.getByRole('button',{name:'Portfolio',exact:true}).count(),0)
  assert.equal((await stats()).admissions,0)
  assert(!report.requests.some(url=>/AprSection-|html-to-image/.test(url)))
  await page.evaluate(()=>{window.__sidebar=document.querySelector('[data-saffron-sidebar]');window.__logo=document.querySelector('[data-saffron-sidebar] canvas')})
  const documentId=await page.evaluate(()=>window.__documentId)
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click()
  await expect(page.getByText(/Payments are simulated/)).toBeVisible()
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  await page.screenshot({path:path.join(output,'vaults-desktop.png'),fullPage:true})
  report.checks.push('Vaults default and no APR admission/chunk or wallet request')

  // Removing public capacity must preserve metric alignment and NEW placement.
  // Check the real compiled layout in both sidebar states at ten widths.
  await page.evaluate(()=>document.fonts.ready)
  for(const width of [320,390,480,640,800,801,1001,1100,1440,1600]){
    await page.setViewportSize({width,height:1100})
    for(const collapsed of width<600?[false]:[false,true]){
      if(collapsed)await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
      const geometry=await page.locator('[data-incentive-offer]').evaluateAll(rows=>rows.map(row=>({
        newLabels:row.querySelectorAll('[data-incentive-new]').length,
        durationFont:getComputedStyle(row.querySelector('[data-incentive-duration]')).font,
        tvlFont:getComputedStyle(row.querySelector('[data-incentive-tvl]')).font,
        publicCapacity:row.querySelectorAll('[data-incentive-capacity], [data-incentive-utilization]').length,
      })))
      report.layouts.push({section:'vaults-metrics',width,collapsed,geometry})
      assert.deepEqual(geometry.map(row=>row.newLabels),[1,0,0],'NEW belongs only to the top offer')
      assert(geometry.every(row=>row.publicCapacity===0),'No public budget utilization')
      assert(geometry.every(row=>row.durationFont===row.tvlFont),'TVL matches Duration typography')
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`vaults overflow ${width}/${collapsed}`)
      if(width>800){
        const spacing=await page.locator('[data-incentive-programs]').evaluate(table=>{
          const headers=[...table.firstElementChild.children].map(el=>el.getBoundingClientRect().left)
          const rows=[...table.querySelectorAll('[data-incentive-offer]')].map(row=>({starts:[...row.children].slice(0,4).map(el=>el.getBoundingClientRect().left),aprRight:row.querySelector('[data-incentive-apr]').getBoundingClientRect().right}))
          return {headers,rows}
        })
        const step=spacing.headers[1]-spacing.headers[0]
        for(let i=1;i<4;i++)assert(Math.abs(spacing.headers[i]-spacing.headers[i-1]-step)<.5,`equal column spacing ${width}/${collapsed}`)
        for(const row of spacing.rows){
          row.starts.forEach((left,i)=>assert(Math.abs(left-spacing.headers[i])<.5,`heading/value alignment ${width}/${collapsed}`))
          assert(row.aprRight<row.starts[2],`APR and Duration remain separate ${width}/${collapsed}`)
        }
      }
      if([320,390,1440].includes(width))await page.screenshot({path:path.join(output,`vaults-${width}-${collapsed?'collapsed':'expanded'}.png`),fullPage:true})
      if(collapsed)await page.getByRole('button',{name:'Open sidebar',exact:true}).click()
    }
  }
  await page.setViewportSize({width:1440,height:1100})
  report.checks.push('Four public metrics including placeholder TVL stay aligned without capacity; only top offer is NEW; ten widths and both sidebar states')

  // Exercise the real lab control in its own page so reloads do not disturb
  // the main suite's persistent-shell and APR-session identity assertions.
  if(await page.locator('summary').filter({hasText:'Tweak'}).count()){
    const preview=await context.newPage()
    preview.on('pageerror',error=>report.errors.push(error.message))
    await preview.goto(origin+base)
    // Older preferences (and malformed new fields) retain unrelated choices.
    await preview.evaluate(()=>localStorage.setItem('saffron.feature-lab.table-typography.v2',JSON.stringify({compactHeader:true,font:'host-regular',aprAnimation:'none',aprDefaultVersion:1,orbitSpeed:2,newOnLeft:'yes'})))
    await preview.reload()
    await preview.locator('summary').filter({hasText:'Tweak'}).click()
    const toggle=preview.getByRole('checkbox',{name:'NEW on left',exact:true})
    await expect(toggle).not.toBeChecked()
    await expect(preview.getByLabel('Table font',{exact:true})).toHaveValue('host-regular')
    await toggle.check()
    await preview.reload()
    await preview.locator('summary').filter({hasText:'Tweak'}).click()
    await expect(toggle).toBeChecked()
    await expect(preview.getByLabel('Table font',{exact:true})).toHaveValue('host-regular')
    await expect(preview.getByLabel('Orbit speed',{exact:true})).toHaveValue('2')
    await preview.locator('summary').filter({hasText:'Tweak'}).click()
    await preview.evaluate(()=>document.fonts.ready)
    for(const width of [320,390,480,640,800,801,1001,1100,1440,1600]){
      await preview.setViewportSize({width,height:1100})
      for(const collapsed of width<600?[false]:[false,true]){
        if(collapsed)await preview.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
        const layout=await preview.locator('[data-incentive-programs]').evaluate(table=>{
          const bounds=el=>{const r=el.getBoundingClientRect();return {left:r.left,right:r.right,width:r.width}}
          const rows=[...table.querySelectorAll('[data-incentive-offer]')]
          return {badge:bounds(table.querySelector('[data-incentive-new]')),headers:[...table.firstElementChild.children].map(bounds),rows:rows.map(row=>({row:bounds(row),cells:[...row.children].filter(el=>el.getClientRects().length).map(bounds)}))}
        })
        if(width>=600)assert(layout.badge.right<=layout.rows[0].cells[0].left,`NEW before Yield ${width}/${collapsed}`)
        assert.equal(await preview.locator('[data-incentive-new]').count(),1)
        for(const row of layout.rows){
          assert(row.cells.every(cell=>cell.left>=row.row.left&&cell.right<=row.row.right),`left-badge containment ${width}/${collapsed}`)
          if(width>800){
            layout.headers.forEach((header,i)=>assert(Math.abs(header.left-row.cells[i].left)<.5,`left-badge heading alignment ${width}/${collapsed}`))
            const step=layout.headers[1].left-layout.headers[0].left
            for(let i=1;i<4;i++)assert(Math.abs(layout.headers[i].left-layout.headers[i-1].left-step)<.5,`left-badge equal column spacing ${width}/${collapsed}`)
          }
        }
        assert.equal(await preview.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`left-badge overflow ${width}/${collapsed}`)
        report.layouts.push({section:'vaults-new-left',width,collapsed,layout})
        if([320,1440].includes(width))await preview.screenshot({path:path.join(output,`new-left-${width}-${collapsed?'collapsed':'expanded'}.png`),fullPage:true})
        if(collapsed)await preview.getByRole('button',{name:'Open sidebar',exact:true}).click()
      }
    }
    await preview.locator('summary').filter({hasText:'Tweak'}).click()
    await preview.getByRole('button',{name:'Reset defaults',exact:true}).click()
    await expect(toggle).not.toBeChecked()
    await preview.reload()
    await preview.locator('summary').filter({hasText:'Tweak'}).click()
    await expect(toggle).not.toBeChecked()
    // Denied storage must not disable the in-memory toggle.
    await preview.evaluate(()=>{const set=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='saffron.feature-lab.table-typography.v2')throw new DOMException('Denied','SecurityError');return set.call(this,key,value)}})
    await toggle.check();await expect(toggle).toBeChecked()
    await preview.close()
    report.checks.push('NEW-left toggle: defaults, validation, preference preservation, reload, reset, storage denial and ten responsive widths')
  }else{
    assert.equal(await page.evaluate(()=>localStorage.getItem('saffron.feature-lab.table-typography.v2')),null)
    report.checks.push('Normal build excludes lab controls and table-preference persistence')
  }

  // Check both offer popups and both primary-action stages without sending a
  // payment. A separate page keeps the main scenario's session/state intact.
  const appearance=await context.newPage()
  appearance.on('pageerror',error=>report.errors.push(error.message))
  await appearance.goto(origin+base)
  await expect(appearance.locator('[data-incentive-offer]')).toHaveCount(3)
  const tweaks=appearance.locator('summary').filter({hasText:'Tweak'})
  const lab=await tweaks.count()>0
  if(lab){
    await tweaks.click()
    for(const animation of ['none','drift','diagonal','shimmer','breathe','orbit','waves']){
      await appearance.getByLabel('APR animation',{exact:true}).selectOption(animation)
      // Moving highlights vary by frame; disable animation clocks during the
      // comparison while retaining the chosen name/duration/gradient rules.
      await appearance.locator('[data-apr-navigation], [data-incentive-apr]').evaluateAll(nodes=>nodes.forEach(node=>{node.style.animationPlayState='paused';node.getAnimations().forEach(animation=>animation.currentTime=0)}))
      await checkAprNavigation(appearance)
    }
    await appearance.getByLabel('APR animation',{exact:true}).selectOption('orbit')
    await tweaks.click()
  }
  const surfaceModes=lab?['afterglow','orbit']:['afterglow']
  for(const mode of surfaceModes){
    if(lab&&mode==='orbit'){
      await tweaks.click()
      await appearance.locator('summary').filter({hasText:'Sidebar appearance'}).click()
      await appearance.getByLabel('Button style',{exact:true}).selectOption(mode)
      await tweaks.click()
      await appearance.reload()
    }
    for(const days of [3,5]){
      await appearance.setViewportSize({width:days===3?1440:390,height:1100})
      await appearance.getByRole('button',{name:`Create CASHCAT / ETH, ${days} days`,exact:true}).click()
      await expect(appearance.getByRole('button',{name:'Continue',exact:true})).toBeEnabled()
      const firstDialog=appearance.getByRole('dialog')
      await expect(firstDialog.locator('label[for="incentive-deposit"]')).toHaveText('Deposit')
      await expect(firstDialog.getByText(/capacity remaining|minimum\./i)).toHaveCount(0)
      await expect(firstDialog.getByRole('heading',{name:'LP tokens',exact:true})).toBeVisible()
      await expect(firstDialog.locator('dt')).toHaveText(['YOU DEPOSIT','YOU GET'])
      await expect(firstDialog.getByText(/Vault creation costs/)).toHaveCount(0)
      const showDetails=firstDialog.getByRole('button',{name:'LP details',exact:true})
      await expect(showDetails).toHaveAttribute('aria-expanded','false')
      await expect(firstDialog.getByText('∞',{exact:true})).toBeHidden()
      await expect(firstDialog.getByRole('button',{name:'Invert price pair',exact:true})).toHaveCount(0)
      await showDetails.focus();await appearance.keyboard.press('Enter')
      const collapseDetails=firstDialog.getByRole('button',{name:'PRICE RANGE: FULL',exact:true})
      await expect(collapseDetails).toBeFocused();await expect(collapseDetails).toHaveAttribute('aria-expanded','true')
      await expect(firstDialog.getByText('∞',{exact:true})).toBeVisible()
      await firstDialog.getByRole('button',{name:'Invert price pair',exact:true}).click()
      await expect(firstDialog.getByText('1,000,000',{exact:true})).toBeVisible()
      const monoText=await firstDialog.evaluate(root=>Array.from(root.querySelectorAll('*')).filter(el=>Array.from(el.childNodes).some(node=>node.nodeType===Node.TEXT_NODE&&node.textContent.trim())&&/mono/i.test(getComputedStyle(el).fontFamily)).map(el=>({text:el.textContent,font:getComputedStyle(el).fontFamily})))
      assert.deepEqual(monoText,[],'First modal has no remaining monospace text')
      for(const label of await firstDialog.locator('dt').all())assert.match(await label.evaluate(el=>getComputedStyle(el).fontFamily),/Funnel Display/)
      await appearance.screenshot({path:path.join(output,`lp-expanded-${mode}-${days}.png`),fullPage:true})
      await collapseDetails.click();await expect(showDetails).toBeFocused()
      await expect(firstDialog.getByText('∞',{exact:true})).toBeHidden()
      await expect(firstDialog.getByRole('heading',{name:'LP tokens',exact:true})).toBeVisible()
      await checkModalSurface(appearance)
      const beforeType=await appearance.locator('[data-incentive-primary-action]').evaluate(el=>{const s=getComputedStyle(el);return [s.fontSize,s.fontWeight,s.letterSpacing,s.textTransform]})
      assert.deepEqual(beforeType,['16px','600','1px','uppercase'])
      await appearance.getByLabel('Deposit value in US dollars').fill('0')
      await expect(appearance.getByRole('button',{name:'Continue',exact:true})).toBeDisabled()
      await appearance.getByLabel('Deposit value in US dollars').fill('100')
      await expect(appearance.getByRole('button',{name:'Continue',exact:true})).toBeEnabled()
      const claim=days===3?'$1.00':'$3.52'
      await expect(appearance.getByLabel('Deposit and incentive')).toHaveText(`Deposit CASHCAT/ETH, get ${claim}`)
      const rewardColor=await firstDialog.locator('[data-testid="upfront-premium"] > b').evaluate(el=>getComputedStyle(el).color)
      await appearance.screenshot({path:path.join(output,`amount-${mode}-${days}-day.png`),fullPage:true})
      await appearance.getByRole('button',{name:'Continue',exact:true}).click()
      await expect(appearance.getByRole('button',{name:`Claim ${claim}`,exact:true})).toBeEnabled()
      await expect(appearance.getByRole('heading',{name:`Claim ${claim}`,exact:true})).toBeVisible()
      await expect(appearance.getByLabel('Deposit and incentive')).toHaveText(`Deposit CASHCAT/ETH, get ${claim}`)
      await expect(appearance.getByText('Creation fee: $2 in ETH plus gas.',{exact:true})).toBeVisible()
      await expect(appearance.getByRole('dialog').getByText(/Preview only|Quote expires|Quote expired|refresh payment quote/)).toHaveCount(0)
      // Both real token assets must load; fallback text is not a logo check.
      assert(await appearance.getByLabel('Deposit and incentive').locator('img').evaluateAll(images=>images.length===2&&images.every(img=>img.complete&&img.naturalWidth>0)))
      const back=appearance.getByRole('button',{name:'← Back',exact:true})
      const backBox=await back.boundingBox(),titleBox=await appearance.getByRole('heading',{name:`Claim ${claim}`,exact:true}).boundingBox()
      const backStyle=await back.evaluate(el=>{
        const s=getComputedStyle(el),nav=getComputedStyle(document.querySelector('[data-saffron-sidebar] nav a'))
        const range=document.createRange();range.selectNodeContents(el)
        return {font:s.fontSize,color:s.color,radius:s.borderRadius,navRadius:nav.borderRadius,textX:range.getBoundingClientRect().x}
      })
      assert(backBox.y+backBox.height<=titleBox.y&&Math.abs(backStyle.textX-titleBox.x)<1,'Back text is above and aligned with the title')
      assert.equal(backStyle.font,'14px');assert.equal(backStyle.color,'rgb(255, 255, 255)');assert.equal(backStyle.radius,backStyle.navRadius)
      await back.hover()
      await expect.poll(()=>back.evaluate(el=>getComputedStyle(el).backgroundColor)).toBe('rgb(29, 29, 29)')
      assert.equal(await appearance.getByRole('heading',{name:`Claim ${claim}`,exact:true}).locator('[data-claim-amount]').evaluate(el=>getComputedStyle(el).color),rewardColor,'Title reward matches the amount-page green')
      assert.equal(await appearance.locator('[data-incentive-primary-action] [data-claim-amount]').evaluate(el=>getComputedStyle(el).color),'rgb(255, 255, 255)','Button amount stays white')
      const bullets=appearance.getByRole('dialog').locator('li')
      await expect(bullets).toHaveCount(3)
      await expect(bullets.last()).toHaveText(`Lock time: ${days} days.`)
      await expect(bullets.nth(1)).toContainText(days===3?'499.99 CASHCAT':'1,755.2 CASHCAT')
      const trigger=appearance.getByRole('button',{name:'$100.00',exact:true})
      const tip=appearance.getByRole('tooltip')
      await expect(tip).toBeHidden()
      // The surrounding sentence is ordinary text, not part of the hover target.
      await appearance.getByText('You deposit:',{exact:true}).hover();await expect(tip).toBeHidden()
      await appearance.getByText('into Uniswap v3.',{exact:true}).hover();await expect(tip).toBeHidden()
      await trigger.hover();await expect(tip).toBeVisible()
      await expect(tip.locator('strong')).toHaveText('Your LP tokens')
      await expect(tip.getByText('Deposited to Uniswap v3',{exact:true})).toBeVisible()
      await expect(tip).toContainText('25,000 CASHCAT');await expect(tip).toContainText('0.0249 ETH')
      await expect(tip.getByText(/Final amounts/)).toHaveCount(0)
      assert(await tip.locator('img').evaluateAll(images=>images.length===2&&images.every(img=>img.complete&&img.naturalWidth>0)))
      const tipBox=await tip.boundingBox(),anchorBox=await trigger.boundingBox()
      assert(tipBox.y+tipBox.height<anchorBox.y,'Tooltip sits above its deposit anchor')
      const caret=await tip.evaluate(el=>{const s=getComputedStyle(el,'::after');return {content:s.content,width:s.width,border:s.borderBottomWidth,transform:s.transform,left:parseFloat(s.left)}})
      assert.notEqual(caret.content,'none');assert.equal(caret.width,'10px');assert.equal(caret.border,'1px');assert.notEqual(caret.transform,'none')
      assert(Math.abs(tipBox.x+1+caret.left-(anchorBox.x+anchorBox.width/2))<1,'Caret points at the dollar amount center')
      await appearance.mouse.move(anchorBox.x+anchorBox.width/2,anchorBox.y-4);await expect(tip).toBeVisible()
      await tip.hover();await expect(tip).toBeVisible()
      await appearance.screenshot({path:path.join(output,`lp-tooltip-${mode}-${days}.png`),fullPage:true})
      await back.hover();await expect(tip).toBeHidden()
      await back.focus();await appearance.keyboard.press('Tab');await expect(trigger).toBeFocused();await expect(tip).toBeVisible()
      await appearance.keyboard.press('Escape');await expect(tip).toBeHidden();await expect(appearance.getByRole('dialog')).toBeVisible()
      const details=appearance.getByRole('dialog').locator('summary')
      assert(await details.locator('span').evaluate(el=>parseFloat(getComputedStyle(el).paddingLeft)>0),'Details marker has visible spacing')
      await details.click();await expect(appearance.getByText('Robinhood Chain · full range.',{exact:true})).toBeVisible();await details.click()
      await checkModalSurface(appearance)
      await appearance.getByRole('button',{name:`Claim ${claim}`,exact:true}).hover()
      await checkModalSurface(appearance)
      await expect.poll(()=>appearance.locator('[data-incentive-primary-action]').evaluate(el=>getComputedStyle(el).filter)).toBe('brightness(1.15)')
      await expect.poll(()=>appearance.locator('[data-incentive-primary-action]').evaluate(el=>getComputedStyle(el).opacity)).toBe('1')
      // Short mobile screens must keep Back, Close and Claim reachable without
      // horizontal overflow; the modal may use its existing vertical scrolling.
      for(const width of [320,390,1440]){
        await appearance.setViewportSize({width,height:740})
        const dialog=appearance.getByRole('dialog')
        assert(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth),'No modal horizontal overflow')
        await trigger.hover();await expect(tip).toBeVisible()
        const bubble=await tip.boundingBox(),amount=await trigger.boundingBox(),modal=await dialog.boundingBox()
        const caretX=await tip.evaluate(el=>parseFloat(getComputedStyle(el,'::after').left))
        assert(Math.abs(bubble.x+1+caretX-(amount.x+amount.width/2))<1,'Caret follows amount after resize')
        assert(bubble.x>=modal.x&&bubble.x+bubble.width<=modal.x+modal.width&&bubble.y>=modal.y&&bubble.y+bubble.height<amount.y,'Tooltip remains above amount and inside modal')
        await back.hover();await expect(tip).toBeHidden()
        await appearance.screenshot({path:path.join(output,`claim-${mode}-${days}-${width}.png`),fullPage:true})
      }
      await appearance.screenshot({path:path.join(output,`review-${mode}-${days}-day.png`),fullPage:true})
      await appearance.emulateMedia({reducedMotion:'reduce'})
      await checkModalSurface(appearance)
      assert.equal(await appearance.locator('[data-incentive-primary-action]').evaluate(el=>getComputedStyle(el).animationName),'none')
      await appearance.emulateMedia({reducedMotion:'no-preference'})
      await back.click()
      await expect(appearance.getByLabel('Deposit value in US dollars')).toHaveValue('$100')
      await expect(appearance.getByLabel('Deposit value in US dollars')).toBeFocused()
      await appearance.getByRole('button',{name:'Close incentive vault',exact:true}).click()
    }
  }
  await appearance.emulateMedia({reducedMotion:'reduce'})
  await checkAprNavigation(appearance)
  if(lab){
    await tweaks.click()
    await appearance.locator('summary').filter({hasText:'Sidebar appearance'}).click()
    await appearance.getByRole('button',{name:'Reset sidebar',exact:true}).click()
    await appearance.getByRole('button',{name:'Reset defaults',exact:true}).click()
  }
  await appearance.close()
  report.checks.push('Home/Portfolio labels and order; unchanged Live APR font with matching paint; both offers/modal stages match selected sidebar, including custom preset, disabled/hover and reduced motion')

  // Emulate real touch input (a small desktop viewport alone cannot verify tap).
  const touchContext=await browser.newContext({viewport:{width:390,height:740},hasTouch:true,isMobile:true})
  await touchContext.route('**/*',route=>{
    const url=new URL(route.request().url())
    if(url.origin!==origin||/\/(api|rpc|prices)\//.test(url.pathname)){report.unexpected.push(url.pathname);return route.abort()}
    return route.continue()
  })
  const touch=await touchContext.newPage()
  touch.on('pageerror',error=>report.errors.push(error.message))
  await touch.goto(origin+base)
  await touch.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).tap()
  await touch.getByRole('button',{name:'LP details',exact:true}).tap()
  await expect(touch.getByText('∞',{exact:true})).toBeVisible()
  await touch.getByRole('button',{name:'PRICE RANGE: FULL',exact:true}).tap()
  await expect(touch.getByText('∞',{exact:true})).toBeHidden()
  await touch.getByRole('button',{name:'Continue',exact:true}).tap()
  const tapTrigger=touch.getByRole('button',{name:'$100.00',exact:true})
  const tapTip=touch.getByRole('tooltip')
  await expect(tapTip).toBeHidden()
  await touch.getByText('You deposit:',{exact:true}).tap();await expect(tapTip).toBeHidden()
  await touch.getByText('into Uniswap v3.',{exact:true}).tap();await expect(tapTip).toBeHidden()
  await tapTrigger.tap();await expect(tapTip).toBeVisible()
  await touch.screenshot({path:path.join(output,'lp-tooltip-touch.png'),fullPage:true})
  const tipBounds=await tapTip.boundingBox(),modalBounds=await touch.getByRole('dialog').boundingBox()
  assert(tipBounds.x>=modalBounds.x&&tipBounds.x+tipBounds.width<=modalBounds.x+modalBounds.width,'Touch tooltip stays within modal')
  assert(tipBounds.y>=modalBounds.y&&tipBounds.y+tipBounds.height<(await tapTrigger.boundingBox()).y,'Touch tooltip stays above anchor and inside modal')
  await tapTrigger.tap();await expect(tapTip).toBeHidden()
  await tapTrigger.tap();await expect(tapTip).toBeVisible()
  await touch.getByText('Creation fee: $2 in ETH plus gas.',{exact:true}).tap();await expect(tapTip).toBeHidden()
  await expect(touch.getByRole('dialog')).toBeVisible()
  await touchContext.close()
  report.checks.push('LP disclosure and first-page copy/Funnel font; amount-only tooltip with token icons, copy and aligned caret; hover/focus/touch dismissal; green title reward and white button amount')

  // Local scaffolds use the same shell and never create observation traffic.
  for(const name of ['Stats','Community']){
    await nav().getByRole('link',{name,exact:true}).click()
    await expect(page.getByRole('heading',{name,exact:true,level:1})).toBeVisible()
    await expect(nav().getByRole('link',{name,exact:true})).toHaveAttribute('aria-current','page')
    await expect(page.locator('main')).toBeFocused()
    assert.equal(await page.evaluate(()=>window.__sidebar===document.querySelector('[data-saffron-sidebar]')),true)
    assert.equal(await page.evaluate(()=>window.__documentId),documentId)
    assert.equal((await stats()).admissions,0)
    for(const width of [320,390,1001,1440]){
      await page.setViewportSize({width,height:1100})
      for(const collapsed of width<=599?[false]:[false,true]){
        if(collapsed)await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} overflow ${width}/${collapsed}`)
        if(collapsed)await page.getByRole('button',{name:'Open sidebar',exact:true}).click()
      }
      if([390,1440].includes(width))await page.screenshot({path:path.join(output,`${name.toLowerCase()}-${width}.png`),fullPage:true})
    }
  }
  await page.emulateMedia({colorScheme:'light'})
  assert.equal(await page.evaluate(()=>getComputedStyle(document.body).backgroundColor),'rgb(0, 0, 0)')
  await page.getByRole('button',{name:/^(Open menu|More)$/}).click()
  assert.equal(await page.getByRole('button',{name:/^(Light|Dark) theme$/}).count(),0)
  assert.equal(await page.getByRole('dialog').getByRole('link',{name:'Portfolio',exact:true}).count(),0)
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  report.checks.push('New sidebar order, external Saffron pro, local Stats/Community, responsive scaffolds and dark-only theme')

  await nav().getByRole('link',{name:'Live APR',exact:true}).click()
  await page.waitForFunction(()=>window.__aprFixture.stats().streams===1)
  await page.evaluate(()=>window.__aprFixture.send())
  await page.waitForFunction(()=>document.querySelector('[data-testid="live-apr"]')?.textContent?.endsWith('%'))
  await page.evaluate(()=>window.__aprFixture.send())
  assert.equal(await page.evaluate(()=>window.__documentId),documentId)
  assert.equal(await page.evaluate(()=>window.__sidebar===document.querySelector('[data-saffron-sidebar]')),true)
  assert.equal(await page.getByTestId('pool-pair-name').textContent(),'NVDA / USDG 0.05%')
  assert.equal(await page.getByText('Sample data · no wallet or transactions',{exact:true}).count(),0)
  await expect(nav().getByRole('link',{name:'Live APR',exact:true})).toHaveAttribute('aria-current','page')
  await checkActiveAprNavigation(page)
  await page.emulateMedia({reducedMotion:'reduce'});await checkActiveAprNavigation(page)
  await page.emulateMedia({reducedMotion:'no-preference'})
  await expect(page.locator('main')).toBeFocused()
  await page.getByRole('button',{name:'Tokens',exact:true}).focus()
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('searchbox')).toBeFocused()
  await page.getByRole('searchbox').fill('NVDA USDG 0.05')
  await page.keyboard.press('ArrowDown')
  await expect(page.getByRole('menuitem',{name:'NVDA / USDG 0.05%',exact:true})).toBeFocused()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('button',{name:'Tokens',exact:true})).toBeFocused()
  await png('apr-single')
  const surface=await page.getByTestId('app-surface').boundingBox(),copy=await page.getByRole('button',{name:'Copy NVDA / USDG 0.05% as PNG',exact:true}).boundingBox()
  assert(Math.abs(copy.y-surface.y-9)<1);assert(Math.abs(surface.x+surface.width-copy.x-copy.width-9)<1)
  await page.getByRole('button',{name:'Swaps since you opened this page',exact:true}).click()
  await page.waitForFunction(()=>window.__aprFixture.stats().histories>0)
  report.checks.push('Default live pair, route-scoped labels, table-corner PNG and history')

  for(const width of [320,390,800,1000,1001,1100,1280,1440,1600]){
    await page.setViewportSize({width,height:1100})
    for(const collapsed of width<=599?[false]:[false,true]){
      if(collapsed)await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
      const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,content:document.querySelector('main').getBoundingClientRect().width}))
      assert(geometry.scroll<=geometry.width,`overflow single ${width} collapsed=${collapsed}: ${JSON.stringify(geometry)}`)
      await page.getByRole('button',{name:'Tokens',exact:true}).click()
      await page.getByRole('searchbox').fill('NVDA USDG 0.05')
      const bounds=await page.locator('#tokens-menu').boundingBox()
      assert(bounds.x>=0&&bounds.x+bounds.width<=width,`menu outside ${width} collapsed=${collapsed}`)
      await expect(page.getByRole('menuitem',{name:'NVDA / USDG 0.05%',exact:true})).toHaveCount(1)
      await page.keyboard.press('Escape')
      if(collapsed)await page.getByRole('button',{name:'Open sidebar',exact:true}).click()
      report.layouts.push({width,collapsed})
    }
    if([390,1440].includes(width))await page.screenshot({path:path.join(output,`apr-${width}.png`),fullPage:true})
  }
  assert.equal((await stats()).admissions,1)
  await page.setViewportSize({width:390,height:1100})
  await page.getByRole('button',{name:/^(Open menu|More)$/}).click()
  assert.equal(await page.getByRole('button',{name:/^(Light|Dark) theme$/}).count(),0)
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  await png('apr-mobile')
  await page.getByRole('button',{name:/^(Open menu|More)$/}).click()
  const labLink=page.getByRole('dialog').getByRole('link',{name:'Feature Lab',exact:true})
  if(await labLink.count())await expect(labLink).toHaveAttribute('href','/saffron/apps/feature-lab/')
  await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click()
  report.checks.push('Expanded/collapsed responsive layouts and Tokens bounds')

  await page.setViewportSize({width:1440,height:1100})
  await page.getByRole('button',{name:'Tokens',exact:true}).click()
  await page.getByRole('searchbox').fill('')
  for(const id of ['cashcat-eth-1','zzz-eth-1','pipedog-eth-1'])await page.locator(`#tokens-menu a[href="${base}live-apr/${id}"]`).locator('..').locator('button').click()
  await page.waitForFunction(()=>window.__aprFixture.stats().streams===4)
  assert.equal(await page.locator('#tokens-menu button:not(:disabled)').count(),0,'Four-pair cap disables every add button')
  await page.keyboard.press('Escape');await page.evaluate(()=>window.__aprFixture.send())
  await png('apr-four')
  for(const width of [320,390,1001,1100,1280,1600]){
    await page.setViewportSize({width,height:1100})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`four-pair overflow ${width}`)
  }
  await page.screenshot({path:path.join(output,'four-pairs.png'),fullPage:true})
  const columns=await page.getByTestId('pool-grid').evaluate(el=>getComputedStyle(el).gridTemplateColumns.split(' ').length)
  assert.equal(columns,2,'Wide content pane uses two comparison columns')
  await page.getByRole('button',{name:'Remove Cash Cat from page',exact:true}).click()
  await page.waitForFunction(()=>window.__aprFixture.stats().streams===3)
  assert.equal((await stats()).admissions,4)
  await page.evaluate(()=>window.__aprFixture.send(0,true))
  await expect(page.getByTestId('live-apr').first()).toHaveText('Unavailable')
  await page.setViewportSize({width:1440,height:1100})
  await nav().getByRole('link',{name:'Stats',exact:true}).click()
  await page.waitForFunction(()=>window.__aprFixture.stats().streams===0)
  assert.equal((await stats()).closes,4)
  await page.goBack();await page.waitForFunction(()=>window.__aprFixture.stats().streams===3)
  assert.equal((await stats()).admissions,7)
  await nav().getByRole('link',{name:'Community',exact:true}).click()
  await page.waitForFunction(()=>window.__aprFixture.stats().streams===0)
  await nav().getByRole('link',{name:'Home',exact:true}).click()
  await checkAprNavigation(page)
  report.checks.push('Comparisons preserve sessions; selected Live APR stays white, inactive gradient returns on Home; fresh back-navigation baseline')

  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  // Advance the actual browser clock beyond the former two-minute deadline.
  // Claim must remain usable; Back must keep the amount and update its reward.
  await page.clock.install()
  await checkModalSurface(page)
  await page.getByLabel('Deposit value in US dollars').fill('1000000')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await checkModalSurface(page)
  await page.clock.fastForward(180_000)
  await expect(page.getByRole('button',{name:'Claim $10,000.00',exact:true})).toBeEnabled()
  await expect(page.getByText(/Quote expired|Quote expires/)).toHaveCount(0)
  await page.getByRole('button',{name:'← Back',exact:true}).click()
  await expect(page.getByLabel('Deposit value in US dollars')).toHaveValue('$1,000,000')
  await page.getByLabel('Deposit value in US dollars').fill('200')
  await expect(page.getByLabel('Deposit and incentive')).toHaveText('Deposit CASHCAT/ETH, get $2.00')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Claim $2.00',exact:true})).toBeVisible()
  await page.getByRole('button',{name:'← Back',exact:true}).click()
  await page.getByLabel('Deposit value in US dollars').fill('1000000')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.clock.fastForward(180_000)
  await page.getByRole('button',{name:'Claim $10,000.00',exact:true}).click()
  report.checks.push('Creation claim survives former expiry; dynamic premium, token logos, Back, fee copy and mobile layout pass')
  await expect(page.getByRole('status').filter({hasText:'Awaiting campaign funding'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Request retirement',exact:true})).toHaveCount(0)
  await expect(page.getByRole('dialog').getByText('Deployment options',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
  await expect(page.locator('[data-incentive-capacity], [data-incentive-utilization]')).toHaveCount(0)
  await nav().getByRole('link',{name:'Portfolio',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Portfolio',exact:true})).toBeVisible()
  await expect(nav().getByRole('link',{name:'Portfolio',exact:true})).toHaveAttribute('aria-current','page')
  await expect(page.locator('[data-deployment-id]')).toHaveCount(1)
  await page.reload();await expect(page.locator('[data-deployment-id]')).toHaveCount(1)
  await page.getByRole('button',{name:'View vault',exact:true}).click()
  await expect(page.getByRole('dialog').getByRole('status').filter({hasText:'Awaiting campaign funding'})).toBeVisible()
  await expect(page.getByRole('button',{name:'Request retirement',exact:true})).toHaveCount(0)
  await expect(page.getByRole('dialog').getByText('Deployment options',{exact:true})).toHaveCount(0)
  await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
  // An over-target request still allows another independent paid sample.
  await nav().getByRole('link',{name:'Home',exact:true}).click()
  await expect(page.getByText(/near capacity|capacity remaining/i)).toHaveCount(0)
  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  await page.getByLabel('Deposit value in US dollars').fill('100')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await page.getByRole('button',{name:'Claim $1.00',exact:true}).click()
  await expect(page.getByRole('list',{name:'Vault creation progress'}).getByRole('listitem')).toHaveCount(4)
  await expect(page.getByText('Sample request progress · no onchain transactions.',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
  await nav().getByRole('link',{name:'Portfolio',exact:true}).click()
  await expect(page.locator('[data-deployment-id]')).toHaveCount(2)
  await expect(page.getByRole('status').filter({hasText:'above the planning target'})).toBeVisible()
  report.checks.push('Above-target request and a second independent payment work; advisory appears only in the operator portfolio')
  await menuLink('Campaigns')
  await expect(page.getByLabel('Campaign APR percent')).toHaveValue('121.666667')
  await page.getByLabel('Calculate campaign field').selectOption('capacity')
  await page.getByLabel('Campaign APR percent').fill('100')
  await expect(page.getByLabel('Campaign capacity USD')).toHaveValue('1216666.66')
  await page.getByLabel('Calculate campaign field').selectOption('budget')
  await expect(page.getByLabel('Campaign budget USD')).toHaveValue('8219.18')
  await page.getByLabel('Calculate campaign field').selectOption('apr')
  await page.getByLabel('Campaign ID',{exact:true}).fill('merge-sample')
  await page.getByLabel('Campaign name',{exact:true}).fill('Merged sample')
  await page.getByRole('button',{name:'Create campaign',exact:true}).click()
  await expect(page.getByText('Campaign configuration saved.',{exact:true})).toBeVisible()
  await page.reload();await expect(page.getByText('Merged sample',{exact:true})).toBeVisible()
  for(const width of [320,390,1001,1440]){
    await page.setViewportSize({width,height:1100})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`campaign overflow ${width}`)
  }
  await page.screenshot({path:path.join(output,'campaigns.png'),fullPage:true})
  await page.getByRole('button',{name:/^(Open menu|More)$/}).click()
  await page.getByRole('button',{name:'Reset preview',exact:true}).click()
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('saffron.live-apr-merge.campaign-preview.v1')).programs.length),3,'Reset persists only the three seed campaigns')
  await expect(page.locator('[data-incentive-offer]')).toHaveCount(3)
  assert.equal(await page.evaluate(()=>localStorage.getItem('saffron.campaign-ui-preview.v1')),'original-preview-sentinel')
  report.checks.push('Calculator modes, local paid requests, saved C06 progress and isolated preview reset')

  await page.goto(origin+base+'?view=campaigns&keep=1#example')
  await page.waitForURL('**/campaigns?keep=1#example')
  await page.goto(origin+base+'live-apr/zzz-eth-005?compare=cashcat-eth-1#fees')
  await page.waitForURL('**/live-apr/zzz-eth-1?compare=cashcat-eth-1#fees')
  await page.waitForFunction(()=>window.__aprFixture.stats().streams===2)
  const before=await stats()
  await page.goto(origin+base+'live-apr/unknown')
  await page.getByRole('heading',{name:'Pool not found',exact:true}).waitFor()
  assert.equal((await stats()).admissions,0)
  await page.goto(origin+base+'unknown')
  await page.getByRole('heading',{name:'Page not found',exact:true}).waitFor()
  assert.equal((await stats()).walletCalls,0)
  report.checks.push('Legacy campaigns/aliases preserve query+fragment; unknown routes admit nothing')
  // Storage denial is a real browser edge, not an incentives/API fallback.
  const temporary=await context.newPage()
  await temporary.emulateMedia({reducedMotion:'reduce'})
  await temporary.addInitScript(()=>{
    const get=Storage.prototype.getItem,set=Storage.prototype.setItem
    Storage.prototype.getItem=function(key){if(key==='saffron.live-apr-merge.campaign-preview.v1')throw new DOMException('Denied','SecurityError');return get.call(this,key)}
    Storage.prototype.setItem=function(key,value){if(key==='saffron.live-apr-merge.campaign-preview.v1')throw new DOMException('Denied','SecurityError');return set.call(this,key,value)}
  })
  await temporary.goto(origin+base)
  await expect(temporary.getByRole('status').filter({hasText:'Browser storage is unavailable'})).toBeVisible()
  await temporary.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Live APR',exact:true}).click()
  await temporary.waitForFunction(()=>window.__aprFixture.stats().streams===1)
  assert.equal(await temporary.getByText(/Browser storage is unavailable/).count(),0)
  await temporary.close()
  for(const route of ['stats','community']){
    await page.goto(origin+base+route);await page.reload()
    await expect(page.locator('main h1')).toHaveText(route==='stats'?'Stats':'Community')
    assert.equal((await stats()).admissions,0)
  }
  report.checks.push('Keyboard Tokens, narrow dark PNG, private budget advisory, storage denial and direct scaffold reloads')
  assert.deepEqual(report.errors,[]);assert.deepEqual(report.unexpected,[])
  report.ok=true;report.realWatchers=0
  await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n')
  console.log(JSON.stringify({...report,requests:report.requests.length}))
} catch(error) {
  report.failure=String(error)
  await writeFile(path.join(output,'verification.json'),JSON.stringify(report,null,2)+'\n')
  await page.screenshot({path:path.join(output,'failure.png'),fullPage:true})
  throw error
} finally {await browser.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve))}
