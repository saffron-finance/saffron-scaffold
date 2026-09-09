import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import { setup } from './fixture.mjs'

const KEY = 'liqifi.pending-incentive-request.v1'
const jsonFile = value => ({ name: 'saffron-incentive-request.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(value)) })

async function payAndExport(page) {
  await page.goto('/')
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).first().click()
  await page.getByRole('button', { name: 'Uniswap Extension', exact: true }).click()
  await page.getByRole('button', { name: 'Request CASHCAT / ETH, 3 days', exact: true }).click()
  await page.getByRole('button', { name: 'Continue', exact: true }).click()
  await page.getByRole('button', { name: 'Request', exact: true }).click()
  await expect(page.getByRole('alert')).toBeVisible()
  const downloadReady = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Save request receipt', exact: true }).click()
  const download = await downloadReady
  expect(download.suggestedFilename()).toBe('saffron-incentive-request.json')
  const buffer = await readFile(await download.path())
  return { file: { name: download.suggestedFilename(), mimeType: 'application/json', buffer }, receipt: JSON.parse(buffer.toString()) }
}

async function chooseReceipt(page, file) {
  const chooserReady = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: /^Import (your )?receipt$/ }).click()
  await (await chooserReady).setFiles(file)
}

async function forgetAndOpenRequests(page, disconnect = false) {
  await page.evaluate(({ key, disconnect }) => {
    localStorage.removeItem(key)
    if (disconnect) localStorage.removeItem('liqifi.selected-wallet-rdns')
  }, { key: KEY, disconnect })
  await page.reload()
  await page.getByRole('button', { name: /^My requests/ }).click()
}

for (const asset of ['USDC', 'ETH']) test(`${asset}: exported unsigned receipt restores after storage loss and submits without another fee`, async ({ page }) => {
  const fixture = await setup(page, { rejectSignature: true, ...(asset === 'ETH' ? { ethBalance: 10n ** 18n } : {}) })
  try {
    const { file, receipt } = await payAndExport(page)
    expect(receipt.payment.asset).toBe(asset)
    expect(receipt.signature).toBeUndefined()
    expect(fixture.state.sends).toBe(1)
    await forgetAndOpenRequests(page)
    await expect(page.getByText('Already paid?', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import your receipt', exact: true })).toBeVisible()
    fixture.state.quoteOffline = true // Recovery must retain its original price/terms.
    await chooseReceipt(page, file)
    await expect(page.getByRole('button', { name: 'Resume request — no new payment', exact: true })).toBeVisible()
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)).toEqual(receipt)
    expect(fixture.state.sends).toBe(1)
    expect(fixture.state.signs).toBe(1)
    expect(await fixture.records()).toHaveLength(0)
    await page.reload()
    await page.getByRole('button', { name: 'Resume paid request', exact: true }).click()
    await expect(page.getByText('Claim $8.22', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Resume request — no new payment', exact: true }).click()
    await expect(page.getByText(/is paid and pending review/)).toBeVisible()
    const saved = await fixture.records()
    expect(saved).toHaveLength(1)
    expect(saved[0].payment).toEqual(receipt.payment)
    expect(saved[0].incentive.quote).toEqual(receipt.incentive.quote)
    expect(fixture.state.sends).toBe(1)
    expect(fixture.state.signs).toBe(2)
  } finally { await fixture.close() }
})

test('signed export rejects changed terms, then resumes an already saved request without another signature or row', async ({ page }) => {
  const fixture = await setup(page, { lostSave: true })
  try {
    const { file, receipt } = await payAndExport(page)
    expect(receipt.signature).toMatch(/^0x[0-9a-f]{130}$/i)
    const before = await fixture.database.list({ wallet: fixture.account.address })
    expect(before).toHaveLength(1)
    await forgetAndOpenRequests(page)
    await expect(page.getByText('Pending review', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import receipt', exact: true })).toBeVisible()
    const changed = structuredClone(receipt)
    changed.incentive.aprPercent += 1
    await chooseReceipt(page, jsonFile(changed))
    await expect(page.getByRole('alert')).toContainText('signature does not match')
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull()
    await chooseReceipt(page, file)
    await expect(page.getByRole('button', { name: 'Resume request — no new payment', exact: true })).toBeVisible()
    expect(fixture.state.sends).toBe(1)
    expect(fixture.state.signs).toBe(1)
    await page.getByRole('button', { name: 'Resume request — no new payment', exact: true }).click()
    await expect(page.getByText(/is paid and pending review/)).toBeVisible()
    expect((await fixture.database.list({ wallet: fixture.account.address })).map(row => row.requestId)).toEqual(before.map(row => row.requestId))
    expect(await fixture.records()).toHaveLength(1)
    expect(fixture.state.sends).toBe(1)
    expect(fixture.state.signs).toBe(1)
  } finally { await fixture.close() }
})

test('bad files, a different wallet and an unfinished payment cannot be silently imported over recovery state', async ({ page }) => {
  const fixture = await setup(page, { rejectSignature: true })
  try {
    const { receipt } = await payAndExport(page)
    await page.getByRole('button', { name: 'Close incentive request', exact: true }).click()
    await page.getByRole('button', { name: /^My requests/ }).click()
    for (const [file, error] of [
      [{ name: 'broken.json', mimeType: 'application/json', buffer: Buffer.from('{') }, 'not valid JSON'],
      [jsonFile({ paymentTxHash: receipt.paymentTxHash }), 'not a supported'],
      [{ name: 'large.json', mimeType: 'application/json', buffer: Buffer.alloc(16_385, ' ') }, 'no larger than 16 KB'],
      [jsonFile({ ...receipt, paymentTxHash: '0x' + 'bc'.repeat(32) }), 'unfinished request is already saved'],
    ]) {
      await chooseReceipt(page, file)
      await expect(page.getByRole('alert')).toContainText(error)
      expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)).toEqual(receipt)
    }
    await forgetAndOpenRequests(page)
    const wrongWallet = { ...receipt, wallet: '0x3333333333333333333333333333333333333333' }
    await chooseReceipt(page, jsonFile(wrongWallet))
    await expect(page.getByRole('alert')).toContainText(`This receipt belongs to ${wrongWallet.wallet}`)
    expect(await page.evaluate(key => localStorage.getItem(key), KEY)).toBeNull()
    expect(fixture.state.sends).toBe(1)
    expect(fixture.state.signs).toBe(1)
    expect(await fixture.records()).toHaveLength(0)
  } finally { await fixture.close() }
})

test('receipt import remains accessible disconnected and during list failures, with mobile review before connecting', async ({ page }) => {
  const fixture = await setup(page, { rejectSignature: true })
  try {
    const { file, receipt } = await payAndExport(page)
    await forgetAndOpenRequests(page)
    await page.route('**/vault-requests/my?*', route => route.fulfill({ status: 503, json: { error: 'Request list unavailable.' } }))
    await page.getByRole('button', { name: 'Refresh requests', exact: true }).click()
    await expect(page.getByRole('alert')).toContainText('Request list unavailable')
    await expect(page.getByRole('button', { name: 'Import receipt', exact: true })).toBeEnabled()
    await chooseReceipt(page, file)
    await expect(page.getByRole('button', { name: 'Resume request — no new payment', exact: true })).toBeVisible()
    await forgetAndOpenRequests(page, true)
    await page.setViewportSize({ width: 390, height: 844 })
    await expect(page.getByRole('button', { name: 'Connect wallet to view requests', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import receipt', exact: true })).toBeEnabled()
    await page.getByRole('dialog', { name: 'My requests', exact: true }).screenshot({ path: 'validation/import-mobile-requests.png', animations: 'disabled' })
    expect(await page.getByRole('dialog').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true)
    await chooseReceipt(page, file)
    await expect(page.getByText('Claim $8.22', { exact: true })).toBeVisible()
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)).toEqual(receipt)
    expect(fixture.state.sends).toBe(1)
    expect(fixture.state.signs).toBe(1)
    const dialog = page.getByRole('dialog', { name: 'Claim $8.22', exact: true })
    await dialog.getByRole('button', { name: 'Connect wallet', exact: true }).click()
    await page.getByRole('button', { name: 'Uniswap Extension', exact: true }).click()
    await expect(dialog.getByRole('button', { name: 'Resume request — no new payment', exact: true })).toBeVisible()
    await dialog.getByRole('button', { name: 'Resume request — no new payment', exact: true }).click()
    await expect(page.getByText(/is paid and pending review/)).toBeVisible()
    expect(fixture.state.sends).toBe(1)
    expect(await fixture.records()).toHaveLength(1)
  } finally { await fixture.close() }
})

test('a legacy receipt for a retired offer keeps its signed format through import and submission', async ({ page }) => {
  const fixture = await setup(page, { rejectSignature: true, resolvePoolFee: async () => 10000 })
  try {
    const { receipt } = await payAndExport(page)
    delete receipt.version; delete receipt.payment; delete receipt.incentive.feeTier
    receipt.incentive.id = 'retired-offer'
    receipt.incentive.slippageBps = 50
    await forgetAndOpenRequests(page)
    fixture.state.quoteOffline = true
    await chooseReceipt(page, jsonFile(receipt))
    await expect(page.getByRole('button', { name: 'Resume request — no new payment', exact: true })).toBeVisible()
    expect(await page.evaluate(key => JSON.parse(localStorage.getItem(key)), KEY)).toEqual(receipt)
    await page.getByRole('button', { name: 'Resume request — no new payment', exact: true }).click()
    await expect(page.getByText(/is paid and pending review/)).toBeVisible()
    const saved = await fixture.records()
    expect(saved).toHaveLength(1)
    expect(saved[0].incentive.id).toBe('retired-offer')
    expect(saved[0].incentive.slippageBps).toBe(50)
    expect(fixture.state.messages.at(-1)).toContain('Saffron / LiqiFi incentive vault request v2')
    expect(fixture.state.sends).toBe(1)
  } finally { await fixture.close() }
})
