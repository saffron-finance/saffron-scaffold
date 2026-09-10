import { spawnSync } from 'node:child_process'
import { mkdirSync,copyFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// An explicit separate entry/config prevents sample data from entering live builds.
// Node executable paths also avoid platform-specific npm/.cmd shell handling.
const root=fileURLToPath(new URL('../',import.meta.url))
for(const args of [['node_modules/typescript/bin/tsc','--noEmit'],['node_modules/vite/bin/vite.js','build','--config','vite.preview.config.ts']]){
  const result=spawnSync(process.execPath,args,{cwd:root,stdio:'inherit',env:{...process.env,VITE_DEV_TWEAKS:'true'},windowsHide:true})
  if(result.error||result.status!==0)process.exit(result.status??1)
}
// Static hosts with no SPA fallback can serve the user's saved-vault route too.
for(const page of ['index.html','portfolio/vaults/index.html','campaigns/index.html','admin/index.html']){
  const target=new URL('../dist-preview/'+page,import.meta.url)
  mkdirSync(dirname(fileURLToPath(target)),{recursive:true})
  copyFileSync(new URL('../dist-preview/preview.html',import.meta.url),target)
}
