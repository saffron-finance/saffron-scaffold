import { createServer } from 'node:http'
import { readFile,mkdir,writeFile,stat } from 'node:fs/promises'
import { resolve,extname,sep } from 'node:path'
import { chromium,expect } from '@playwright/test'
import assert from 'node:assert/strict'

// Exercise only static preview files on a temporary loopback listener. Any API,
// RPC, injected-wallet or external request is a test failure, not a mock response.
const root=resolve(process.env.PREVIEW_WEBROOT||'dist-preview')
const output=resolve(process.env.PREVIEW_EVIDENCE_DIR||'validation/preview-ui')
const prefix='/saffron/apps/feature-lab/liquidity-incentives/'
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.jpg':'image/jpeg','.png':'image/png','.woff2':'font/woff2','.ttf':'font/ttf','.glb':'model/gltf-binary'}
const sockets=new Set(),requests=[],errors=[]
const server=createServer(async(req,res)=>{
  try{
    const url=new URL(req.url,'http://localhost')
    if(!url.pathname.startsWith(prefix))throw new Error('Outside preview')
    const relative=url.pathname.slice(prefix.length)||'index.html',file=resolve(root,relative)
    if(!file.startsWith(root+sep))throw new Error('Outside preview')
    const info=await stat(file),target=info.isDirectory()?resolve(file,'index.html'):file
    res.setHeader('content-type',mime[extname(target)]||'application/octet-stream');res.end(await readFile(target))
  }catch{res.writeHead(404);res.end()}
})
server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
await new Promise(r=>server.listen(0,'127.0.0.1',r))
const origin='http://127.0.0.1:'+server.address().port
const browser=await chromium.launch({headless:true})
try{
  await mkdir(output,{recursive:true})
  const page=await browser.newPage({viewport:{width:1440,height:1050}})
  page.on('pageerror',e=>errors.push(e.message))
  await page.addInitScript(()=>{window.ethereum={request:async()=>{throw new Error('The UI preview attempted to use a real wallet.')}}})
  await page.route('**/*',route=>{const u=new URL(route.request().url());requests.push({path:u.pathname,method:route.request().method()});if(u.origin!==origin||/\/(api|rpc|prices)\//.test(u.pathname)||route.request().method()!=='GET'){errors.push('Unexpected non-static request: '+u.pathname);return route.abort()}return route.continue()})
  await page.goto(origin+prefix)
  await expect(page.getByText('Sample data · no wallet or transactions',{exact:true})).toBeVisible()
  await expect(page.locator('[data-incentive-offer]')).toHaveCount(1)
  await expect(page.getByRole('link',{name:'Vaults',exact:true})).toHaveAttribute('aria-current','page')
  await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible()
  await expect(page.getByText('Tweak',{exact:true})).toBeVisible()
  await page.evaluate(()=>document.fonts.ready)
  for(const font of ['Funnel Display','Host Grotesk','Roboto Mono']){
    assert.equal(await page.evaluate(name=>document.fonts.check(`14px "${name}"`),font),true, font+' loaded locally')
  }
  const appearance=await page.evaluate(()=>{
    const card=document.querySelector('[data-incentive-offer]'),title=document.querySelector('main h1')
    return {sidebarWidth:document.querySelector('[data-saffron-sidebar]').getBoundingClientRect().width,cardHeight:card.getBoundingClientRect().height,cardBackground:getComputedStyle(card).backgroundColor,titleFont:getComputedStyle(title).fontFamily,titleSize:getComputedStyle(title).fontSize}
  })
  assert.equal(appearance.sidebarWidth,252)
  assert.equal(appearance.cardHeight,124)
  assert.equal(appearance.cardBackground,'rgb(10, 10, 10)')
  assert.equal(appearance.titleSize,'44px')
  assert.match(appearance.titleFont,/Funnel Display/)
  await expect(page.locator('[data-incentive-offer]').getByText('50%',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Connect wallet',exact:true}).click()
  await expect(page.getByText('Feature Lab preview',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Continue preview',exact:true}).click()
  await expect(page.getByText('$500K',{exact:true})).toBeVisible()
  await page.screenshot({path:output+'/offers-desktop.png',fullPage:true})
  await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).click()
  await page.getByLabel('Deposit value in US dollars').fill('100000')
  await page.getByRole('button',{name:'Continue',exact:true}).click()
  await expect(page.getByRole('button',{name:'Pay $2 in ETH',exact:true})).toBeVisible()
  await expect(page.getByText('Pay request fee with',{exact:true})).toHaveCount(0)
  await page.screenshot({path:output+'/payment-review.png',fullPage:true})
  await page.getByRole('button',{name:'Pay $2 in ETH',exact:true}).click()
  await expect(page.getByRole('status').filter({hasText:'Awaiting campaign funding'})).toBeVisible()
  await page.getByRole('button',{name:'Close incentive vault',exact:true}).click()
  await page.getByRole('button',{name:'My requests',exact:true}).click()
  await page.reload()
  await expect(page.locator('[data-deployment-id]')).toHaveCount(1)
  await page.getByRole('button',{name:'Open menu',exact:true}).click()
  await page.getByRole('link',{name:'Campaigns',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Campaigns',exact:true})).toBeVisible()
  await expect(page.getByLabel('Campaign APR percent')).toHaveValue('121.666667')
  assert.notEqual(await page.getByLabel('Campaign ID',{exact:true}).evaluate(el=>getComputedStyle(el).color),'rgb(0, 0, 0)','campaign fields must be legible on the dark background')
  const example=page.getByText('3-day campaign · sample',{exact:true}).locator('../..')
  await expect(example.getByText('$5,000.00',{exact:true})).toBeVisible()
  await expect(example.getByText('$400,000.00',{exact:true})).toBeVisible()
  await page.getByLabel('Calculate campaign field').selectOption('capacity')
  await page.getByLabel('Campaign APR percent').fill('100')
  await expect(page.getByLabel('Campaign capacity USD')).toHaveValue('1216666.66')
  await page.getByLabel('Calculate campaign field').selectOption('budget')
  await expect(page.getByLabel('Campaign budget USD')).toHaveValue('8219.18')
  await page.getByLabel('Calculate campaign field').selectOption('apr')
  await page.getByLabel('Campaign ID',{exact:true}).fill('preview-new-campaign')
  await page.getByLabel('Campaign name',{exact:true}).fill('New sample campaign')
  await page.getByRole('button',{name:'Create campaign',exact:true}).click()
  await expect(page.getByText('Campaign configuration saved.',{exact:true})).toBeVisible()
  await page.reload()
  await expect(page.getByText('New sample campaign',{exact:true})).toBeVisible()
  for(const width of [1440,390,320]){
    await page.setViewportSize({width,height:1000})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'campaigns fit '+width)
    await page.screenshot({path:output+'/campaigns-'+width+'.png',fullPage:true})
  }
  await page.setViewportSize({width:1440,height:1050})
  await page.getByRole('button',{name:'Open menu',exact:true}).click()
  await expect(page.getByRole('dialog').locator('..')).toHaveCSS('opacity','1')
  await page.screenshot({path:output+'/navigation-menu.png',fullPage:true})
  await page.getByRole('link',{name:'Administration',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Administration',exact:true})).toBeVisible()
  await expect(page.getByText(/Reviewed request execution/)).toBeVisible()
  await page.screenshot({path:output+'/administration.png',fullPage:true})
  for(const width of [390,320]){
    await page.setViewportSize({width,height:1000})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'administration fits '+width)
    await page.goto(origin+prefix)
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'vaults fit '+width)
    await page.screenshot({path:output+'/offers-'+width+'.png',fullPage:true})
    await page.getByRole('button',{name:'Open menu',exact:true}).click()
    for(const name of ['Vaults','My requests','Campaigns','Administration'])await expect(page.getByRole('dialog').getByRole('link',{name,exact:true})).toBeVisible()
    await page.getByRole('button',{name:'Close',exact:true}).click()
    await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'collapsed vaults fit '+width)
    const overlap=await page.locator('[data-incentive-offer]').first().evaluate(card=>{
      const apr=card.querySelector('[data-incentive-apr]').getBoundingClientRect(),duration=card.children[2].getBoundingClientRect()
      return Math.min(apr.right,duration.right)>Math.max(apr.left,duration.left)&&Math.min(apr.bottom,duration.bottom)>Math.max(apr.top,duration.top)
    })
    assert.equal(overlap,false,'APR and duration never overlap at '+width)
    await page.screenshot({path:output+'/offers-compact-'+width+'.png',fullPage:true})
    await page.getByRole('button',{name:'Open sidebar',exact:true}).click()
  }
  // Old shared campaign links still resolve into the new standalone page.
  await page.goto(origin+prefix+'?view=campaigns')
  await expect(page.getByRole('heading',{name:'Campaigns',exact:true})).toBeVisible()
  assert.equal(new URL(page.url()).pathname,prefix+'campaigns/')
  assert.deepEqual(errors,[])
  await writeFile(output+'/verification.json',JSON.stringify({ok:true,root,staticOnly:true,walletCalls:0,appearance,errors,requests,checks:['approved font families loaded locally','original sidebar/card/header geometry','Vaults homepage and all menu routes','desktop/mobile/compact navigation','exact shared campaign calculator','half-funded sample','local payment review/creation','capacity decreases after simulated payment','campaign creation persists locally','deep-link reload','desktop/390/320 layout','no API/RPC/price/wallet calls']},null,2))
  console.log('Preview browser checks passed: calculator, payment review, local capacity, saved campaign, deep-link reload, mobile and no live calls.')
}finally{await browser.close();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r))}
