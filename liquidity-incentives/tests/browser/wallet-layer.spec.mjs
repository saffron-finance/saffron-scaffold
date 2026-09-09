import { test, expect } from '@playwright/test'
import { setup } from './fixture.mjs'

// Exercise real dialog hit-testing, not visibility alone: a covered picker is
// still "visible" to the browser. No payment or signature is needed here.
for (const width of [1440, 390]) test(`wallet picker stays above deposit review at ${width}px`, async ({ page }) => {
  const fixture = await setup(page)
  try {
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
    await page.getByLabel('Deposit value in US dollars').fill('100')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    const review = page.getByRole('dialog', { name: 'Claim $8.22', exact: true })
    const connect = review.getByRole('button', { name: 'Connect wallet', exact: true })
    await connect.click()
    const provider = page.getByRole('button', { name: 'Uniswap Extension', exact: true })
    await expect(provider).toBeVisible()

    // Make the underlying portal last in DOM order, the ordering that previously
    // hid the picker. Semantic layers must win regardless of portal insertion.
    await review.evaluate(node => {
      const portal = node.closest('.ReactModalPortal')
      portal.parentElement.appendChild(portal)
    })
    await expect.poll(() => provider.evaluate(node => {
      const box = node.getBoundingClientRect()
      return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2))
    })).toBe(true)
    await provider.focus()
    await page.keyboard.press('Escape')
    await expect(provider).toHaveCount(0)
    await expect(review).toBeVisible()
    await expect(connect).toBeFocused()

    // Reopening and selecting a provider must leave the original review intact.
    await connect.click()
    await provider.click()
    await expect(provider).toHaveCount(0)
    await expect(review).toBeVisible()
    expect(fixture.state.sends).toBe(0)
    expect(fixture.state.signs).toBe(0)
  } finally { await fixture.close() }
})
