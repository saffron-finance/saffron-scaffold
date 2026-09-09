import { test, expect } from '@playwright/test'
import { setup } from './fixture.mjs'

async function submit(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click()
  await page.getByRole('button', { name: 'Uniswap Extension', exact: true }).click()
  await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
  await page.getByLabel('Deposit value in US dollars').fill('1000.29')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByLabel('Vault request summary').getByText('Details', { exact: true }).click()
  await expect(page.getByText('Requested vault size', { exact: true })).toBeVisible()
  await expect(page.getByText('Program maximum', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Request', exact: true }).click()
  await expect(page.getByText(/is paid and pending review/)).toBeVisible()
  await page.getByRole('button', { name: 'Done', exact: true }).click()
  await page.getByRole('button', { name: /^My requests/ }).click()
  await expect(page.getByText('Pending review', { exact: true })).toBeVisible()
}

async function admin(page) {
  await page.getByText('Admin requests', { exact: true }).click()
  await page.getByRole('button', { name: 'Load admin requests', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Review & create vault' })).toBeVisible()
}

test('admin handoff opens the FI creation form for the same request and selected size', async ({ page }) => {
  const f = await setup(page, { handoff: true })
  try {
    await submit(page)
    const [row] = await f.database.list({ wallet: f.account.address })
    expect(row.fixedCapacityAmount).toBe('100029')
    await expect(page.getByRole('button', { name: 'Review & create vault' })).toHaveCount(0)
    await admin(page)
    await page.route('**/fixed-income/network/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixed-income destination</p>' }))
    const signs = f.state.signs
    await page.getByRole('button', { name: 'Review & create vault' }).click()
    await expect(page).toHaveURL(/\/fixed-income\/network\/robinhood\/admin\/create-vault\?/)
    const query = new URL(page.url()).searchParams
    expect(query.get('cap')).toBe('1000.29'); expect(query.get('reqId')).toBe(row.requestId)
    expect(query.get('dy')).toBe('3'); expect(query.get('apr')).toBe('10'); expect(query.get('useApr')).toBe('true')
    expect(f.state.sends).toBe(1); expect(f.state.signs).toBe(signs)
    expect(f.state.handoffReads).toBe(1)
    await f.database.pool.query("UPDATE uniswap_v3_fiv.pending_vaults SET status='created',created_vault_address=$1", ['0x' + '67'.repeat(20)])
    await page.goBack()
    await expect(page.getByRole('dialog', { name: 'My requests', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open fixed side', exact: true }).first()).toBeVisible()
  } finally { await f.close() }
})

for (const side of ['fixed', 'variable']) test(`created request opens the existing ${side}-side vault flow`, async ({ page }) => {
  const f = await setup(page, { handoff: true })
  try {
    if (side === 'variable') await page.setViewportSize({ width: 390, height: 844 })
    await submit(page)
    const vault = '0x' + '56'.repeat(20)
    await f.database.pool.query("UPDATE uniswap_v3_fiv.pending_vaults SET status='created',created_vault_address=$1", [vault])
    // Returning from FI refreshes the public queue without another signature.
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(page.getByRole('button', { name: 'Open fixed side', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Open variable side', exact: true })).toBeVisible()
    if (side === 'variable') await page.screenshot({ path: 'validation/vault-entry-mobile.png', fullPage: true, animations: 'disabled' })
    await page.route('**/fixed-income/network/**', route => route.fulfill({ contentType: 'text/html', body: '<p>Fixed-income destination</p>' }))
    const signs = f.state.signs
    await page.getByRole('button', { name: `Open ${side} side`, exact: true }).click()
    await expect(page).toHaveURL(`http://127.0.0.1:13218/fixed-income/network/robinhood/vault/${vault}/${side}`)
    expect(f.state.sends).toBe(1); expect(f.state.signs).toBe(signs)
  } finally { await f.close() }
})

test('missing queue and API outages keep the user on the saved request without another payment', async ({ page }) => {
  const f = await setup(page, { handoff: true, handoffMissing: true })
  try {
    await submit(page); await admin(page)
    await page.getByRole('button', { name: 'Review & create vault' }).click()
    await expect(page.getByRole('alert')).toContainText('does not show this same request')
    expect(new URL(page.url()).pathname).toBe('/')
    f.state.handoffMissing = false; f.state.handoffOffline = true
    await page.getByRole('button', { name: 'Review & create vault' }).click()
    await expect(page.getByRole('alert')).toContainText('Fixed-income is unavailable')
    expect(f.state.sends).toBe(1)
    expect((await f.database.list({ wallet: f.account.address })).length).toBe(1)
  } finally { await f.close() }
})
