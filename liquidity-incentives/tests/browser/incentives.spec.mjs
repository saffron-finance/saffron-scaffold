import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { setup } from './fixture.mjs'

const PAGE = '/'

/** Select the real EIP-6963 picker beside an unrelated default extension. */
async function connect(page) {
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click()
  await page.getByRole('button', { name: 'Uniswap Extension', exact: true }).click()
}

/** Continue freezes terms without paying; only the final Request submits. */
async function review(page) {
  await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
  await page.getByLabel('Deposit value in US dollars').fill('100')
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await expect(page.getByText('Claim $8.22', { exact: true })).toBeVisible()
}

test('beta layout, isolated offers, two-step copy and mobile keyboard access', async ({ page }) => {
  const fixture = await setup(page)
  // Hold the initial price response to verify a quiet but safely disabled form.
  let releasePrice
  const priceReady = new Promise(resolve => { releasePrice = resolve })
  try {
    await page.route('**/prices/*', async route => { await priceReady; await route.fallback() })
    await page.goto(PAGE)
    await expect(page.getByLabel('CASHCAT / ETH liquidity incentive offers').locator('[data-incentive-offer]')).toHaveCount(4)
    await expect(page.getByLabel('Featured liquidity incentives')).toHaveCount(0)
    const offers = page.locator('[data-incentive-offer]')
    for (const offer of await offers.all()) {
      await expect(offer).toHaveCSS('border-top-color', 'rgb(29, 29, 29)')
      const badge = offer.getByRole('img', { name: 'Robinhood Chain', exact: true })
      await expect(badge).toHaveCSS('width', '20px')
      await expect(badge).toHaveCSS('height', '20px')
      await expect(badge).toHaveCSS('right', '-7px')
      await expect(badge).toHaveCSS('bottom', '-5px')
    }
    await page.evaluate(() => document.fonts.ready)
    const beforeHover = await offers.first().boundingBox()
    await offers.first().hover()
    await expect(offers.first()).toHaveCSS('border-top-color', 'rgb(255, 188, 9)')
    await expect(offers.first()).toHaveCSS('border-top-width', '1px')
    expect(await offers.first().boundingBox()).toEqual(beforeHover)
    await page.screenshot({ path: 'validation/borderless-home.png', fullPage: true, animations: 'disabled' })
    await page.mouse.move(0, 0)
    await expect(offers.first()).toHaveCSS('border-top-color', 'rgb(29, 29, 29)')
    await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
    await expect(page.getByRole('dialog')).toHaveCSS('border-top-color', 'rgb(58, 48, 44)')
    await expect(page.getByLabel('Deposit value in US dollars')).toBeFocused()
    await expect(page.getByLabel('Deposit value in US dollars')).toHaveCSS('border-top-color', 'rgb(255, 188, 9)')
    const next = page.getByRole('button', { name: 'Continue', exact: true })
    await expect(next).toBeDisabled()
    await expect(page.getByTestId('position-value')).toHaveText('—')
    await expect(page.getByTestId('upfront-premium')).toHaveText('—')
    await expect(page.getByText('Loading live pool price…', { exact: true })).toHaveCount(0)
    const beforePrice = await next.boundingBox()
    releasePrice()
    await expect(page.getByText('Pay request fee with', { exact: true })).toHaveCount(0)
    const title = page.getByRole('dialog').getByRole('heading')
    await expect(title).toContainText('CASHCAT / ETH')
    await expect(title.getByText('1,000% APR', { exact: true })).toHaveCSS('background-clip', 'text')
    await expect(title.getByText('1,000% APR', { exact: true })).not.toHaveCSS('background-image', 'none')
    await expect(title.getByText('1,000% APR', { exact: true })).toHaveCSS('font-size', '16px')
    await expect(title.getByText('3 days', { exact: true })).toHaveCSS('font-size', '14px')
    await expect(title.getByText('3 days', { exact: true })).toHaveCSS('color', 'rgb(126, 122, 119)')
    await expect(title.locator('img')).toHaveCount(2)
    await expect(page.getByText('Advanced settings', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Resume a request', { exact: true })).toHaveCount(0)
    await expect(page.locator('input[type=file]')).toHaveCount(0)
    const range = page.getByLabel('Full price range')
    await expect(range).toBeVisible()
    await expect(range.getByText('Price range: full', { exact: true })).toBeVisible()
    await expect(range.locator('[aria-hidden=true]')).toHaveCSS('background-color', 'rgb(31, 162, 74)')
    const marker = range.locator('i')
    await expect(marker).toHaveCSS('background-color', 'rgb(255, 255, 255)')
    await expect(marker).toHaveCSS('width', '5px')
    await expect(marker).toHaveCSS('height', '20px')
    await expect(marker).toHaveCSS('border-radius', '4px')
    await expect(page.getByRole('button', { name: 'Invert price pair' })).toHaveCSS('border-top-width', '0px')
    await expect(page.getByRole('button', { name: 'Invert price pair' })).toHaveCSS('background-color', 'rgb(26, 23, 23)')
    await page.getByRole('button', { name: 'Invert price pair' }).click()
    await expect(page.getByRole('button', { name: 'Invert price pair' })).toContainText('ETH / CASHCAT')
    await page.getByRole('button', { name: 'Invert price pair' }).click()
    const tokens = page.getByRole('group', { name: 'Tokens required for LP' })
    await expect(tokens).toHaveCSS('border-top-color', 'rgb(42, 36, 34)')
    await expect(tokens).toHaveCSS('row-gap', '16px')
    await expect(tokens.locator('img')).toHaveCount(2)
    await expect(tokens.locator('img').first()).toHaveAttribute('src', `${PAGE}cashcat.png`)
    await expect(tokens.locator('img').last()).toHaveAttribute('src', `${PAGE}eth.svg`)
    // Input changes must recalculate the underlying quote, not freeze mockup numbers.
    await page.getByLabel('Deposit value in US dollars').fill('200')
    await expect(page.getByLabel('Deposit value in US dollars')).toHaveCSS('border-top-color', 'rgb(255, 188, 9)')
    await expect(tokens.locator('b').first()).toHaveText('50,000')
    await expect(tokens.locator('b').last()).toHaveText('0.05')
    await page.getByLabel('Deposit value in US dollars').fill('100')
    await expect(tokens.locator('b').first()).toHaveText('25,000')
    await expect(tokens.locator('b').last()).toHaveText('0.025')
    await expect(next).toBeEnabled()
    expect(Math.abs((await next.boundingBox()).y - beforePrice.y)).toBeLessThan(1)
    await page.getByRole('dialog').screenshot({ path: 'validation/deposit-first-desktop.png', animations: 'disabled' })
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    await expect(page.getByText('Claim $8.22', { exact: true })).toBeVisible()
    await expect(page.getByLabel('Vault request summary')).toHaveJSProperty('open', false)
    await expect(page.getByLabel('Vault request summary')).toHaveCSS('border-top-color', 'rgb(42, 36, 34)')
    await expect(page.getByRole('button', { name: /^ETH/ })).toHaveCSS('border-top-color', 'rgb(42, 36, 34)')
    await expect(page.getByText('Pay request fee with', { exact: true })).toBeVisible()
    expect(fixture.state.sends).toBe(0)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await page.setViewportSize({ width: 390, height: 844 })
    await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
    await expect(tokens).toBeVisible()
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeEnabled()
    await page.getByRole('dialog').screenshot({ path: 'validation/deposit-first-mobile.png', animations: 'disabled' })
    expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog')).toBeHidden()
    await review(page)
    await expect(page.getByRole('dialog')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    const box = await page.getByRole('dialog').boundingBox()
    expect(box.width).toBeLessThanOrEqual(390)
    await page.screenshot({ path: 'validation/mobile-review.png', fullPage: true })
  } finally { releasePrice(); await fixture.close() }
})

test('USD formatting and live premium stay consistent with the signed request', async ({ page }) => {
  const fixture = await setup(page)
  try {
    await page.goto(PAGE); await connect(page)
    await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
    const input = page.getByLabel('Deposit value in US dollars')
    const position = page.getByTestId('position-value')
    const premium = page.getByTestId('upfront-premium')
    const next = page.getByRole('button', { name: 'Continue', exact: true })
    await expect(input).toHaveValue('$100')
    await expect(position).toHaveText('$100.00')
    await expect(premium).toHaveText('4,110=+$8.22')
    await expect(premium.getByLabel('CASHCAT')).toBeVisible()
    await expect(premium.locator('img')).toHaveAttribute('src', `${PAGE}cashcat.png`)
    await input.fill('')
    await expect(input).toHaveValue('')
    await expect(next).toBeDisabled()
    await expect(premium).toHaveText('—')
    await input.fill('100001')
    await expect(next).toBeDisabled()
    await expect(position).toHaveText('—')
    await input.fill('10000.25')
    await expect(input).toHaveValue('$10,000.25')
    await expect(position).toHaveText('$10,000.25')
    await expect(premium).toHaveText('410,969=+$821.94')
    // A new live USD price changes the token quantity, not APR-based USD yield.
    await page.route('**/prices/0x0bd7d308f8e1639fab988df18a8011f41eacad73', async route => {
      await route.fulfill({ json: { success: true, data: {
        chainId: 4663, tokenAddress: '0x0bd7d308f8e1639fab988df18a8011f41eacad73',
        price: 4000, timestamp: new Date().toISOString(), currency: 'usd',
      } } })
    })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect(premium).toHaveText('205,485=+$821.94')
    await expect(position).toHaveText('$10,000.25')
    await next.click()
    await expect(page.getByText('Claim $821.94', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Request', exact: true }).click()
    await expect(page.getByText(/is paid and pending review/)).toBeVisible()
    const [saved] = await fixture.records()
    expect(saved.incentive.depositUsd).toBe('10000.25')
    expect(saved.incentive.quote.rewardCashcat).toBeCloseTo(10000.25 * 10 * 3 / 365 / 0.004)
    expect(saved.incentive.quote.rewardUsd).toBeCloseTo(10000.25 * 10 * 3 / 365)
  } finally { await fixture.close() }
})

for (const asset of ['USDC', 'ETH']) {
  test(`${asset} full dry run: selected wallet, Arbitrum fee, canonical DB row, user/admin visibility`, async ({ page }) => {
    const fixture = await setup(page, asset === 'ETH' ? { ethBalance: 10n ** 18n } : {})
    try {
      await page.goto(PAGE); await connect(page); await review(page)
      await expect(page.getByRole('button', { name: new RegExp(`^${asset}`) })).toHaveAttribute('aria-pressed', 'true')
      await page.getByRole('button', { name: 'Request', exact: true }).click()
      await expect(page.getByText(/is paid and pending review/)).toBeVisible()
      expect(fixture.state.sends).toBe(1)
      expect(fixture.state.chain).toBe('0xa4b1')
      const saved = await fixture.records()
      expect(saved).toHaveLength(1)
      expect(saved[0].payment.asset).toBe(asset)
      expect(saved[0].incentive.chainId).toBe(4663)
      expect(saved[0].incentive.depositUsd).toBe('100')
      const rows = await fixture.database.pool.query('SELECT * FROM uniswap_v3_fiv.pending_vaults')
      expect(rows.rows).toHaveLength(1)
      expect(Number(rows.rows[0].target_apr)).toBe(10)
      await page.getByRole('button', { name: 'Done', exact: true }).click()
      await page.getByRole('button', { name: /^My requests/ }).click()
      await expect(page.getByText('Awaiting creation', { exact: true }).first()).toBeVisible()
      await page.getByRole('button', { name: 'Admin queue', exact: true }).click()
      await page.getByRole('button', { name: 'Sign in as operator', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Create vault', exact: true })).toBeVisible()
      await page.goto('/portfolio/requests')
      await expect(page.getByText('Awaiting creation', { exact: true }).first()).toBeVisible()
      expect(fixture.state.sends).toBe(1)
    } finally { await fixture.close() }
  })
}

test('paid signature cancellation reloads and resumes without another fee', async ({ page }) => {
  const fixture = await setup(page, { rejectSignature: true })
  try {
    await page.goto(PAGE); await connect(page); await review(page)
    await page.getByRole('button', { name: 'Request', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('cancelled')
    expect(fixture.state.sends).toBe(1)
    await page.reload()
    await page.getByRole('button', { name: 'Resume paid request', exact: true }).click()
    await page.getByRole('button', { name: 'Resume request — no new payment', exact: true }).click()
    await expect(page.getByText(/is paid and pending review/)).toBeVisible()
    expect(fixture.state.sends).toBe(1)
    expect(await fixture.records()).toHaveLength(1)
  } finally { await fixture.close() }
})

test('a confirmed onchain cancellation can be cleared after reload and a new request submitted', async ({ page }) => {
  const fixture = await setup(page)
  const original = { tx: structuredClone(fixture.chain.tx), receipt: structuredClone(fixture.chain.receipt) }
  const hash = '0x' + 'cd'.repeat(32)
  const pending = { version: 3, kind: 'incentive', chain: 'robinhood', depositToken: 'USD',
    pair: 'CASHCAT / ETH', depositAmount: '100', wallet: fixture.account.address,
    recipient: '0x2222222222222222222222222222222222222222', paymentTxHash: hash,
    payment: { asset: 'USDC', amountRaw: '2000000', quoteId: randomUUID() },
    incentive: { id: 'cashcat-eth-1000-3d', chainId: 4663,
      poolAddress: '0xA70fc67C9F69da90B63a0e4C05D229954574E313', feeTier: 10000,
      token0: { address: '0x020bfC650A365f8BB26819deAAbF3E21291018b4', symbol: 'CASHCAT', decimals: 18 },
      token1: { address: '0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73', symbol: 'ETH', decimals: 18 },
      durationDays: 3, capacityUsd: 100000, aprPercent: 1000, depositUsd: '100', range: 'full',
      quote: { cashcatAmount: 25000, quoteAmount: 0.025, rewardUsd: 1000 * 3 / 365,
        rewardCashcat: 1000 * 3 / 365 / 0.002, cashcatUsd: 0.002, quoteTokenUsd: 2000,
        quotePerCashcat: 0.000001, quotedAt: '2026-09-06T10:00:00.000Z' } } }
  Object.assign(fixture.chain.tx, { hash, to: fixture.account.address, value: '0x0', input: '0x' })
  Object.assign(fixture.chain.receipt, { transactionHash: hash, to: fixture.account.address, logs: [] })
  await page.addInitScript(receipt => {
    if (sessionStorage.getItem('fixture-cancel-receipt')) return
    localStorage.setItem('liqifi.pending-incentive-request.v1', JSON.stringify(receipt))
    sessionStorage.setItem('fixture-cancel-receipt', 'true')
  }, pending)
  try {
    await page.goto(PAGE); await connect(page)
    for (let attempt = 0; attempt < 2; attempt++) {
      await page.getByRole('button', { name: 'Resume paid request', exact: true }).click()
      await page.getByRole('button', { name: 'Resume request — no new payment', exact: true }).click()
      await expect(page.getByRole('alert')).toContainText('cancelled onchain')
      await expect(page.getByRole('button', { name: 'Clear confirmed cancelled payment', exact: true })).toBeVisible()
      expect(fixture.state.sends).toBe(0)
      expect(fixture.state.signs).toBe(0)
      expect(await fixture.records()).toHaveLength(0)
      if (attempt === 0) await page.reload()
    }
    await page.getByRole('button', { name: 'Clear confirmed cancelled payment', exact: true }).click()
    await page.getByLabel('Deposit value in US dollars').fill('200')
    await page.getByRole('button', { name: 'Continue', exact: true }).click()
    Object.assign(fixture.chain.tx, original.tx)
    Object.assign(fixture.chain.receipt, original.receipt)
    await page.getByRole('button', { name: 'Request', exact: true }).click()
    await expect(page.getByText(/is paid and pending review/)).toBeVisible()
    expect(fixture.state.sends).toBe(1)
    expect((await fixture.records())[0].incentive.depositUsd).toBe('200')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Resume paid request', exact: true })).toHaveCount(0)
  } finally { await fixture.close() }
})

test('manual fee choice survives balance refetch, missing price cannot pay', async ({ page }) => {
  const fixture = await setup(page, { ethBalance: 10n ** 18n })
  try {
    await page.goto(PAGE); await connect(page); await review(page)
    await expect(page.getByRole('button', { name: /^ETH/ })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: /^USDC/ }).click()
    await page.getByRole('button', { name: 'Refresh', exact: true }).click()
    await expect(page.getByRole('button', { name: /^USDC/ })).toHaveAttribute('aria-pressed', 'true')
    await page.getByRole('button', { name: 'Close incentive request', exact: true }).click()
    fixture.state.quoteOffline = true
    await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
    await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeDisabled()
    expect(fixture.state.sends).toBe(0)
  } finally { await fixture.close() }
})
