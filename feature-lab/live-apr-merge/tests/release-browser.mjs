import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { smokeBrowser } from '../scripts/check_browser.mjs'
import { checkDeployment } from '../scripts/check_live.mjs'

/** Qualify the served build against the real proxy, API, database and EVM in a
 * disposable fixture. This does not qualify an external host or APR gateway. */
const frontend = process.cwd(), source = process.env.SAFFRON_BACKEND_SOURCE
assert(source, 'Set SAFFRON_BACKEND_SOURCE to the canonical package with test dependencies')
const dist = resolve(process.env.MERGE_WEBROOT || 'dist-live')
const marker = JSON.parse(await readFile(resolve(dist, 'deployment-mode.json'), 'utf8'))
const { setup } = await import(pathToFileURL(resolve(source, 'tests/browser/fixture.mjs')).href)
process.env.DIST_DIR = dist
process.chdir(resolve(source))
const browser = await chromium.launch({ headless: true }), page = await browser.newPage()
let fixture
try {
  fixture = await setup(page, { campaign: true, basePath: marker.basePath.replace(/\/$/, '') })
  const policy = await fixture.database.intakePolicy(fixture.chain.account.address)
  await fixture.database.saveIntake({ signer: fixture.chain.account.address, revision: policy.revision,
    mode: 'automatic', enabled: false, expiresAt: new Date(Date.now() + 3600000).toISOString(),
    serviceMinutes: 60, watcherId: 'intake-fixture' }, fixture.chain.account.address)
  const target = fixture.origin + '/'
  const report = await smokeBrowser(target, { expectClosed: true, requireClean: false, expectedRelease: marker.release })
  await fixture.database.execution.heartbeat(fixture.chain.account.address)
  await fixture.chain.prepareIntake(fixture.database, { mode: 'automatic', continuous: true })
  const opened = await checkDeployment(target, { requireClean: false, expectedRelease: marker.release })
  assert.equal(opened.paymentReady, true)
  assert.equal((await fixture.database.list({ wallet: fixture.account.address })).jobs.length, 0)
  assert.equal(fixture.state.sends, 0)
  const output = resolve(frontend, 'validation/release')
  await mkdir(output, { recursive: true })
  const evidence = { ...report, fixtureOnly: true, openReadinessVerified: opened.paymentReady, jobsCreated: 0 }
  await writeFile(resolve(output, marker.basePath === '/' ? 'root.json' : 'nested.json'), JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence))
} finally { if (fixture) await fixture.close(); await browser.close() }
