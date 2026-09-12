import { chromium,expect as baseExpect } from '@playwright/test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir,writeFile } from 'node:fs/promises'

/** Verify the merged admin and campaign surfaces with the canonical backend.
 * Build first; an optional mount exercises the final nested production build. */
const frontend=process.cwd(),backend=resolve(frontend,'../../liquidity-incentives')
const evidence=resolve(process.env.MERGE_EVIDENCE||'validation/configuration')
const {configurationJourney}=await import(pathToFileURL(resolve(backend,'tests/browser/configuration-journey.mjs')))
process.env.DIST_DIR=resolve(frontend,'dist');process.chdir(backend)
await mkdir(evidence,{recursive:true})
const browser=await chromium.launch({headless:true}),results=[]
try{
  for(const missingFeeRecipient of [true,false]){
    const page=await browser.newPage({viewport:{width:1440,height:1000}})
    page.setDefaultTimeout(20000)
    results.push(await configurationJourney(page,{expect:baseExpect.configure({timeout:20000}),missingFeeRecipient,campaignPage:true,basePath:process.env.MERGE_BASE_PATH||'',screenshot:resolve(evidence,missingFeeRecipient?'missing-recipient.png':'configured-recipient.png')}))
    await page.close()
  }
  await writeFile(resolve(evidence,'verification.json'),JSON.stringify({ok:true,results},null,2)+'\n')
  console.log(JSON.stringify({ok:true,results}))
}finally{await browser.close()}
