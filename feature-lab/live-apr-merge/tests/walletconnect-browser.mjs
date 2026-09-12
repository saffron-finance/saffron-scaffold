import { expect } from '@playwright/test'

/** Real AppKit pairing UI, with the disposable peer and external directory
 * substituted. No WalletConnect relay, project account or phone is qualified. */
export async function prepareWalletConnect(context) {
  await context.addInitScript(() => { window.fixtureWalletLinks = []; window.open = url => { window.fixtureWalletLinks.push(String(url)); return null } })
  await context.route('https://**/*', route => {
    const url = new URL(route.request().url())
    if (!/(?:web3modal|reown|walletconnect)\.(?:org|com)$/.test(url.hostname)) return route.abort()
    if (url.pathname.includes('Image')) return route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="blue"/></svg>' })
    const data = url.pathname === '/getWallets' ? { data: [{ id: 'fixture-wallet', name: 'Fixture Mobile Wallet', mobile_link: 'fixturewallet://', desktop_link: '', webapp_link: '', image_id: 'fixture-image', order: 1, supports_wc: true, chains: ['eip155:4663'] }], count: 1 }
      : url.pathname.includes('project-limits') ? { planLimits: { tier: 'unlimited', isAboveMauLimit: false, isAboveRpcLimit: false } }
      : { features: {}, allowedOrigins: [] }
    return route.fulfill({ json: data })
  })
}
export async function connectWalletConnect(page, report) {
  expect(await page.evaluate(() => Boolean(window.fixtureWalletConnect))).toBe(false)
  await page.getByRole('button', { name: 'Create CASHCAT / ETH, 3 days', exact: true }).click()
  await page.getByLabel('Deposit value in US dollars').fill('123')
  await page.getByRole('dialog').getByRole('button', { name: 'Connect wallet', exact: true }).click()
  await page.getByRole('button', { name: 'WalletConnect', exact: true }).click()
  const sheet = page.locator('w3m-modal')
  await expect(sheet).toBeVisible()
  await expect(page.locator('.ReactModal__Content')).toHaveCount(0)
  await expect(sheet.getByText('Fixture Mobile Wallet', { exact: true })).toBeVisible()
  await sheet.locator('wui-icon-box[icon=qrCode]').click()
  await expect(sheet.getByTestId('wui-qr-code')).toHaveAttribute('uri', /^wc:/)
  await sheet.locator('w3m-header').getByRole('button').last().click()
  await expect(page.getByRole('alert')).toContainText('cancelled')
  await expect(page.getByLabel('Deposit value in US dollars')).toHaveValue('$123')
  await page.evaluate(() => window.fixtureWalletConnect.reject())
  await page.getByRole('button', { name: 'WalletConnect', exact: true }).click()
  await expect(sheet.getByText('Fixture Mobile Wallet', { exact: true })).toBeVisible()
  // The pairing sheet owns keyboard focus, including its shadow DOM.
  await sheet.getByRole('searchbox', { name: 'Search wallet' }).focus()
  await page.keyboard.press('Tab')
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName)).toBe('W3M-MODAL')
  await sheet.getByText('Fixture Mobile Wallet', { exact: true }).click()
  await expect(sheet.getByText(/Open.*Wallet|Continue in/i).first()).toBeVisible()
  await expect.poll(() => page.evaluate(() => window.fixtureWalletLinks.some(link => link.startsWith('fixturewallet://') && link.includes('wc%3A')))).toBe(true)
  await page.evaluate(() => window.fixtureWalletConnect.approve())
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toHaveCount(0)
  const options = await page.evaluate(() => window.fixtureWalletConnect.options)
  expect(options.optionalChains).toEqual([4663])
  expect(options.rpcMap[4663]).toBe(new URL('rpc/robinhood', page.url()).href)
  expect(options.metadata.url).toBe(new URL(page.url()).origin)
  await page.getByRole('button', { name: 'Close incentive vault', exact: true }).click()
  report.checks.push('QR rendering, cancellation preserving form input, retry; real AppKit mobile sheet and focus, explicit peer approval, Robinhood-only permissions and same-origin gas/nonce reads')
}
