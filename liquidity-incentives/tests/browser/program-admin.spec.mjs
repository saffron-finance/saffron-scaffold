import { test, expect } from '@playwright/test'
import { setup } from './fixture.mjs'

async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click()
  await page.getByRole('button', { name: 'Uniswap Extension', exact: true }).click()
}
async function admin(page) {
  await page.getByRole('button', { name: /^My requests/ }).click()
  await page.getByText('Manage incentive programs', { exact: true }).click()
  await page.getByRole('button', { name: 'Load incentive catalog', exact: true }).click()
}

test('owner edits a shared pair, creates and pauses programs, and sees database rows on desktop and mobile', async ({ page }) => {
  const f = await setup(page)
  try {
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.goto('/'); await connect(page); await admin(page)
    await page.getByRole('button', { name: 'Edit pair cashcat-eth', exact: true }).click()
    await page.getByLabel('Yield token symbol', { exact: true }).fill('CAT')
    await page.getByRole('button', { name: 'Save pair', exact: true }).click()
    await expect(page.getByText('Catalog saved. Updated offers are now available.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Add program', exact: true }).click()
    await page.getByLabel('Program ID', { exact: true }).fill('weekly-cat')
    await page.getByLabel('APR (%)', { exact: true }).fill('550')
    await page.getByLabel('Duration (days)', { exact: true }).fill('7')
    await page.getByLabel('Proposed capacity (USD)', { exact: true }).fill('25000')
    await page.getByLabel('Display order', { exact: true }).fill('-1')
    await page.getByLabel('Show NEW badge', { exact: true }).check()
    await page.getByRole('button', { name: 'Save program', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Edit program weekly-cat', exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Edit program cashcat-eth-800-2d', exact: true }).click()
    await page.getByLabel('Program active', { exact: true }).uncheck()
    await page.getByRole('button', { name: 'Save program', exact: true }).click()
    await expect(page.getByText('cashcat-eth-800-2d · 800% · 2 days · Paused', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close pending requests' }).click()
    await expect(page.getByTestId('pool-pair-name')).toHaveText('CAT / ETH 1%')
    await expect(page.locator('[data-incentive-offer]').first()).toHaveAttribute('data-incentive-offer', 'weekly-cat')
    await expect(page.locator('[data-incentive-offer]')).toHaveCount(4)
    await expect(page.getByRole('button', { name: 'Request CAT / ETH, 2 days' })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('button', { name: 'Request CAT / ETH, 7 days' })).toContainText('550%')
    await page.screenshot({ path: 'validation/catalog-managed-desktop.png', fullPage: true })
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: /^My requests/ }).click()
    await page.getByText('Manage incentive programs', { exact: true }).click()
    await page.getByRole('button', { name: 'Load incentive catalog', exact: true }).click()
    await page.getByRole('button', { name: 'Edit program weekly-cat', exact: true }).click()
    await page.getByLabel('APR (%)', { exact: true }).scrollIntoViewIfNeeded()
    expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.screenshot({ path: 'validation/catalog-admin-mobile.png', fullPage: true })
    expect(f.state.sends).toBe(0)
  } finally { await f.close() }
})

test('ordinary wallets cannot load or edit the administrative catalog', async ({ page }) => {
  const f = await setup(page, { notAdmin: true })
  try {
    await page.goto('/'); await connect(page); await admin(page)
    await expect(page.getByRole('alert')).toContainText('factory-owner wallet')
    await expect(page.getByRole('button', { name: 'Add program', exact: true })).toHaveCount(0)
    expect(f.state.signs).toBe(0); expect(f.state.sends).toBe(0)
  } finally { await f.close() }
})

test('catalog outages and an empty catalog keep receipt recovery and admin access available', async ({ page }) => {
  const f = await setup(page)
  try {
    await page.route('**/incentive-programs', route => route.fulfill({ status: 503, json: { error: 'Catalog temporarily unavailable.' } }))
    await page.goto('/')
    await expect(page.getByRole('alert')).toContainText('Catalog temporarily unavailable')
    await expect(page.locator('[data-incentive-offer]')).toHaveCount(0)
    await page.getByRole('button', { name: /^My requests/ }).click()
    await expect(page.getByRole('button', { name: 'Import receipt', exact: true })).toBeVisible()
    await expect(page.getByText('Manage incentive programs', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Close pending requests' }).click()
    await f.database.pool.query('UPDATE liqifi.incentive_programs SET active=FALSE')
    await page.unroute('**/incentive-programs')
    await page.getByRole('button', { name: 'Refresh offers', exact: true }).click()
    await expect(page.getByText('No incentive programs are available right now.', { exact: true })).toBeVisible()
    await expect(page.getByRole('alert')).toHaveCount(0)
  } finally { await f.close() }
})

test('an already-paid request resumes its original terms after its program is paused and edited', async ({ page }) => {
  const f = await setup(page, { rejectSignature: true })
  try {
    await page.goto('/'); await connect(page)
    await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await page.getByRole('button', { name: 'Request', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Resume request — no new payment', exact: true })).toBeEnabled()
    const original = (await f.database.catalog(true)).programs[0]
    await f.database.saveProgram({ ...original, active: false, apr: 500 }, f.account.address)
    await page.reload()
    await page.getByRole('button', { name: 'Resume paid request', exact: true }).click()
    await expect(page.getByRole('dialog')).toContainText('1,000% APR')
    await page.getByRole('button', { name: 'Resume request — no new payment', exact: true }).click()
    await expect(page.getByText(/is paid and pending review/)).toBeVisible()
    expect(f.state.sends).toBe(1)
    const [record] = await f.records()
    expect(record.incentive.aprPercent).toBe(1000)
  } finally { await f.close() }
})
