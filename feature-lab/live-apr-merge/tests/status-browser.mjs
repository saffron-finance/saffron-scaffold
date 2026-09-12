import { chromium,expect as baseExpect } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir,writeFile } from 'node:fs/promises'

/** Run after a normal or nested-mount build, against the canonical fixture. */
const frontend=process.cwd(),backend=resolve(process.env.SAFFRON_BACKEND_SOURCE||resolve(frontend,'../../liquidity-incentives'))
const evidence=resolve(process.env.MERGE_EVIDENCE||'validation/status')
const {statusJourney}=await import(pathToFileURL(resolve(backend,'tests/browser/status-journey.mjs')))
process.env.DIST_DIR=resolve(frontend,'dist');process.chdir(backend)
await mkdir(evidence,{recursive:true})
const browser=await chromium.launch({headless:true})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.setDefaultTimeout(20000)
  const result=await statusJourney(page,{expect:baseExpect.configure({timeout:20000}),basePath:process.env.MERGE_BASE_PATH||'',merged:true,evidence})
  await writeFile(resolve(evidence,'verification.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result))
}finally{await browser.close()}
