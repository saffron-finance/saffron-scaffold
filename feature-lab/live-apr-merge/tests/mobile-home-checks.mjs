import { readFile } from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { expect } from '@playwright/test'
import { fixtureTransport } from './fixture-transport.mjs'

/** Compare the real compiled Home to the independently approved HTML concept,
 * then exercise real route/payment handlers in an isolated preview browser.
 * No real wallet, API or running VNC profile participates in this check. */
export async function checkMobileHome({browser,origin,base,output,report,wire}) {
  const context=await browser.newContext({viewport:{width:390,height:736},isMobile:true,hasTouch:true})
  await context.addInitScript(fixtureTransport,wire)
  await context.route('**/*',route=>{
    const url=new URL(route.request().url())
    if(url.origin!==origin||/\/(api|rpc|prices)\//.test(url.pathname)){report.unexpected.push(url.pathname);return route.abort()}
    return route.continue()
  })
  const page=await context.newPage()
  page.on('pageerror',error=>report.errors.push(error.message))
  try {
    await page.goto(origin+base)
    await expect(page.locator('[data-incentive-offer]')).toHaveCount(3)
    await page.evaluate(()=>document.fonts.ready)
    await expect(page.getByRole('heading',{name:'Liquidity incentives',exact:true})).toBeVisible()
    await expect(page.locator('[data-saffron-sidebar]')).toBeHidden()
    await expect(page.getByRole('button',{name:'Open menu',exact:true})).toBeHidden()
    const nav=page.getByRole('navigation',{name:'Mobile navigation',exact:true})
    await expect(nav.getByRole('link')).toHaveText(['Home','Portfolio','Live APR'])
    await expect(nav.getByRole('link',{name:'Home',exact:true})).toHaveAttribute('aria-current','page')
    await expect(page.getByRole('button',{name:'Connect wallet',exact:true})).toBeVisible()
    await page.screenshot({path:path.join(output,'mobile-home-390.png'),fullPage:false})

    // The concept contains a fake 24px OS status bar. Only real webpage
    // geometry is compared; the browser/phone supplies its own status area.
    const referenceFile=new URL('../../mobile-design-20260912/saffron-mobile-design-2026-09-12.html',import.meta.url)
    let reference
    try {reference=await readFile(referenceFile,'utf8')} catch(error) {if(error.code!=='ENOENT')throw error}
    if(reference){
      const referencePage=await context.newPage()
      await referencePage.setViewportSize({width:1440,height:1100})
      await referencePage.setContent(reference)
      // Its decorative frame has a 1px border on each side. Give the actual
      // embedded webpage the same 390px viewport as the compiled app.
      await referencePage.locator('#main-device').evaluate(el=>el.style.setProperty('--device-width','392px'))
      const frame=referencePage.frameLocator('#mobile-prototype')
      await expect(frame.locator('.campaign')).toHaveCount(3)
      await frame.locator('body').evaluate(()=>document.fonts.ready)
      const actual=await page.locator('[data-incentive-offer]').evaluateAll(rows=>rows.map(row=>{
        const r=row.getBoundingClientRect(),apr=row.querySelector('[data-incentive-apr]'),value=row.querySelector('[data-incentive-duration]')
        return {x:r.x,y:r.y,width:r.width,height:r.height,aprFont:getComputedStyle(apr).fontSize,valueFont:getComputedStyle(value).fontSize,valueFamily:getComputedStyle(value).fontFamily,aprFamily:getComputedStyle(apr).fontFamily,radius:getComputedStyle(row).borderRadius}
      }))
      const approved=await frame.locator('.campaign').evaluateAll(rows=>rows.map(row=>{
        const r=row.getBoundingClientRect()
        return {x:r.x,y:r.y-24,width:r.width,height:r.height,aprFont:getComputedStyle(row.querySelector('.apr')).fontSize,valueFont:getComputedStyle(row.querySelector('.metric strong')).fontSize,radius:getComputedStyle(row).borderRadius}
      }))
      report.layouts.push({section:'approved-mobile-home-reference',actual,approved})
      for(let i=0;i<3;i++){
        assert.match(actual[i].valueFamily,/Funnel Display/);assert.match(actual[i].aprFamily,/Funnel Display/)
        for(const key of ['x','y','width','height'])assert(Math.abs(actual[i][key]-approved[i][key])<2,`Concept ${key} differs: ${JSON.stringify({actual,approved})}`)
        for(const key of ['aprFont','valueFont','radius'])assert.equal(actual[i][key],approved[i][key])
      }
      await referencePage.close()
      report.checks.push('390px compiled Home card geometry and typography match the approved independent HTML concept (excluding mock OS chrome)')
    }
    // Verify both ends of the phone cutoff and short-height scrolling. Bottom
    // padding must let the final card scroll fully above the fixed navigation.
    for(const width of [320,390,430,599]){
      await page.setViewportSize({width,height:640})
      assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Home overflow ${width}`)
      const cards=page.locator('[data-incentive-offer]')
      await expect(cards).toHaveCount(3)
      await expect(page.locator('[data-incentive-new]')).toHaveCount(1)
      const metrics=await cards.evaluateAll(rows=>rows.map(row=>{
        const duration=row.querySelector('[data-incentive-duration]'),tvl=row.querySelector('[data-incentive-tvl]')
        return {d:duration.getBoundingClientRect().y,t:tvl.getBoundingClientRect().y,font:getComputedStyle(duration).font,tvlFont:getComputedStyle(tvl).font}
      }))
      assert(metrics.every(x=>x.d===x.t&&x.font===x.tvlFont),'Duration/TVL share their row and font')
      await cards.last().scrollIntoViewIfNeeded()
      await page.evaluate(()=>window.scrollTo(0,document.documentElement.scrollHeight))
      assert((await cards.last().boundingBox()).y+(await cards.last().boundingBox()).height<=(await nav.boundingBox()).y,`Last card obscured ${width}`)
      for(const target of await nav.locator('a,button').all()){
        const box=await target.boundingBox();assert(box.width>=44&&box.height>=44)
      }
      await page.evaluate(()=>window.scrollTo(0,0))
      if(width===320)await page.screenshot({path:path.join(output,'mobile-home-320.png'),fullPage:true})
    }
    await page.setViewportSize({width:390,height:736})
    const how=page.getByText('How it works',{exact:true})
    await how.tap();await expect(page.getByText(/Pay the \$2 request fee in ETH/)).toBeVisible()
    await page.getByRole('button',{name:'Refresh offers',exact:true}).tap()
    await expect(page.locator('[data-incentive-offer]')).toHaveCount(3);await how.tap()
    // Each card opens the existing offer-specific modal, not a hardcoded mock.
    for(const days of [3,5,7]){
      await page.getByRole('button',{name:`Create CASHCAT / ETH, ${days} days`,exact:true}).tap()
      await expect(page.getByLabel('Deposit value in US dollars')).toBeVisible()
      await page.getByRole('button',{name:'Continue',exact:true}).tap()
      await expect(page.getByRole('dialog').getByText(`Lock time: ${days} days.`,{exact:true})).toBeVisible()
      await page.getByRole('button',{name:'Close incentive vault',exact:true}).tap()
    }
    await nav.getByRole('button',{name:'More',exact:true}).tap()
    await expect(page.getByRole('dialog').getByRole('link',{name:'Portfolio',exact:true})).toBeVisible()
    await expect(page.getByRole('dialog').getByRole('link',{name:'Source & installation',exact:true})).toBeVisible()
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).tap()
    await expect(nav.getByRole('button',{name:'More',exact:true})).toBeFocused()
    await nav.getByRole('link',{name:'Live APR',exact:true}).tap()
    await expect(page.getByTestId('pool-pair-name')).toHaveText('NVDA / USDG 0.05%')
    await page.goBack();await expect(nav).toBeVisible()
    await page.getByRole('button',{name:'Connect wallet',exact:true}).tap()
    await expect(page.getByText(/Payments are simulated/)).toBeVisible()
    await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).tap()
    // An existing request survives Home navigation, reload, and status reads.
    await page.getByRole('button',{name:'Create CASHCAT / ETH, 3 days',exact:true}).tap()
    await page.getByLabel('Deposit value in US dollars').fill('200')
    await page.getByRole('button',{name:'Continue',exact:true}).tap()
    await page.getByRole('button',{name:'← Back',exact:true}).tap()
    await expect(page.getByLabel('Deposit value in US dollars')).toHaveValue('$200')
    await page.getByRole('button',{name:'Continue',exact:true}).tap()
    await page.getByRole('button',{name:'Claim $2.00',exact:true}).tap()
    await expect(page.getByRole('status').filter({hasText:'Awaiting campaign funding'})).toBeVisible()
    await page.getByRole('button',{name:'Close incentive vault',exact:true}).tap()
    await nav.getByRole('link',{name:'Portfolio',exact:true}).tap()
    await expect(page.locator('[data-deployment-id]')).toHaveCount(1)
    const id=await page.locator('[data-deployment-id]').getAttribute('data-deployment-id')
    await page.reload();await expect(page.locator('[data-deployment-id]')).toHaveAttribute('data-deployment-id',id)
    await page.getByRole('navigation',{name:'Main navigation',exact:true}).getByRole('link',{name:'Home',exact:true}).tap()
    await expect(nav).toBeVisible()
    // Switching from a collapsed desktop rail cannot leave a phone-sized gutter.
    await page.setViewportSize({width:1440,height:1100})
    await page.getByRole('button',{name:'Collapse sidebar',exact:true}).click()
    await page.setViewportSize({width:390,height:736})
    assert.equal((await page.locator('[data-incentive-offer]').first().boundingBox()).x,16)
    await expect(nav).toBeVisible();await expect(page.locator('[data-saffron-sidebar]')).toBeHidden()
    report.checks.push('Phone Home: 320–599px geometry, final-card clearance, real touch offers, More/focus, routes, Connect, Back, canonical preview request persistence and collapsed-desktop resize pass')
  }catch(error){await page.screenshot({path:path.join(output,'mobile-home-failure.png'),fullPage:true});throw error}
  finally{await context.close()}
}
