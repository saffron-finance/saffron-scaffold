import { test, expect } from '@playwright/test'
import { setup,connect } from './fixture.mjs'

// Real host interactions over local data only: collapsing must not navigate,
// remount the logo, cover the content, or leave invisible links keyboard-active.
test('compact rail reopens from its blank area and keyboard without remounting', async ({ page }) => {
  const fixture = await setup(page)
  try {
    await page.goto(fixture.origin)
    const rail = page.locator('[data-saffron-sidebar]')
    const collapse = page.getByRole('button', { name: 'Collapse sidebar', exact: true })
    const reopen = page.getByRole('button', { name: 'Open sidebar', exact: true })
    const surface = rail.locator('[data-sidebar-surface]')
    await expect(rail.locator('canvas')).toHaveCount(1)
    await rail.locator('canvas').evaluate(node => { window.sidebarCanvasBefore = node })
    const originalUrl = page.url()
    for (const width of [1401, 1024, 390, 320]) {
      await page.setViewportSize({ width, height: 831 })
      await collapse.click()
      await expect(reopen).toBeFocused()
      await expect(rail.getByRole('link')).toHaveCount(0)
      for (const icon of await rail.locator('nav svg').all()) await expect(icon).toBeVisible()
      const box = await rail.boundingBox()
      expect(box.width).toBe(64)
      expect(box.height).toBe(831)
      expect(await page.locator('#main-content').evaluate(node => node.getBoundingClientRect().left)).toBeGreaterThanOrEqual(64)
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      // Stay at the left edge: only the painted surface moves, not its hit area.
      await reopen.hover({ position: { x: 1, y: 700 } })
      await expect(surface).toHaveCSS('transform', 'matrix(1, 0, 0, 1, 4, 0)')
      await page.mouse.move(200, 700)
      await expect(surface).toHaveCSS('transform', 'none')
      await reopen.click({ position: { x: 32, y: 700 } })
      await expect(collapse).toBeFocused()
      expect(page.url()).toBe(originalUrl)
      expect(await rail.locator('canvas').evaluate(node => node === window.sidebarCanvasBefore)).toBe(true)
      await collapse.click()
      await page.keyboard.press('Space')
      await expect(collapse).toBeVisible()
    }
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await collapse.click()
    await reopen.hover()
    await expect(surface).toHaveCSS('transform', 'none')
    await expect(surface).toHaveCSS('transition-duration', '0s')
    expect(fixture.state.sends).toBe(0)
  } finally { await fixture.close() }
})

// The initial field accepts typing immediately; data updates must not steal
// focus, while Continue/Back and Escape keep focus within the modal workflow.
test('deposit field is focused on open and Back, with no refresh focus steal', async ({ page }) => {
  const fixture = await setup(page)
  // Delay a quote itself; a synthetic window-focus event would also reload the
  // separate catalog and replace the original offer button being tested.
  let releasePrice
  const priceReady = new Promise(resolve => { releasePrice = resolve })
  try {
    await page.route('**/prices/*', async route => { await priceReady; await route.fallback() })
    await page.goto(fixture.origin);await connect(page)
    const offer = page.getByRole('button', { name: 'Create CASHCAT / ETH, 3 days', exact: true })
    const input = page.getByLabel('Deposit value in US dollars')
    for (const width of [1401, 390]) {
      await page.setViewportSize({ width, height: 831 })
      await offer.click()
      await expect(input).toBeFocused()
      await input.fill('125')
      await page.getByRole('button', { name: 'Invert price pair' }).click()
      releasePrice()
      await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
      await expect(page.getByRole('button', { name: 'Invert price pair' })).toBeFocused()
      await expect(input).toHaveValue('$125')
      await page.getByRole('button', { name: 'Continue', exact: true }).click()
      await expect(page.getByRole('dialog').getByRole('heading')).toBeFocused()
      await page.getByRole('button', { name: 'Change amount / refresh payment quote', exact: true }).click()
      await expect(input).toBeFocused()
      await expect(input).toHaveValue('$125')
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog')).toBeHidden()
      await expect(offer).toBeFocused()
    }
    expect(fixture.state.sends).toBe(0)
  } finally { releasePrice(); await fixture.close() }
})
