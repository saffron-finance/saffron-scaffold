import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp,mkdir,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve,join } from 'node:path'
import { sourceFiles,sourceIdentity } from '../scripts/release-source.mjs'
test('source identity normalizes checkout line endings, excludes runtime settings and rejects changed exports',async()=>{
  const prefix=join(tmpdir(),'saffron-release-'),root=await mkdtemp(prefix)
  try{
    const config={trees:['src'],singles:['package.json','source-files.json'],excludedNames:['node_modules'],excludedSuffixes:['.zip'],textExtensions:['.mjs','.json'],textNames:[]}
    await writeFile(join(root,'source-files.json'),JSON.stringify(config));await writeFile(join(root,'package.json'),JSON.stringify({name:'test',version:'1.0.0'}))
    await mkdir(join(root,'src'));await writeFile(join(root,'src/app.mjs'),'export const n=1\n')
    const first=sourceFiles(root)
    await writeFile(join(root,'src/app.mjs'),'export const n=1\r\n');await writeFile(join(root,'src/.env.local'),'ignored=test-only')
    assert.deepEqual(sourceFiles(root),first)
    const release={version:'1.0.0',revision:'a'.repeat(40),sourceDigest:first.sourceDigest,dirty:false}
    await writeFile(join(root,'source-manifest.json'),JSON.stringify({release}))
    assert.deepEqual(sourceIdentity(root),release)
    await writeFile(join(root,'src/app.mjs'),'export const n=2\n')
    assert.throws(()=>sourceIdentity(root),/differs/)
  }finally{if(!resolve(root).startsWith(resolve(prefix)))throw Error('Unexpected release test directory');await rm(root,{recursive:true,force:true})}
})
