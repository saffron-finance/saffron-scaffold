import {it} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {sourceHash,verifySources} from '../scripts/source-sync.mjs'
it('line endings are portable while changed or missing backend files fail',async()=>{
  const prefix=join(tmpdir(),'saffron-source-'),root=await mkdtemp(prefix),backend=join(root,'backend'),text='export const value = 1\n'
  try{
    await mkdir(join(root,'docs'));await mkdir(backend)
    await writeFile(join(root,'docs/upstream-sync.json'),JSON.stringify({exactFiles:{'shared.mjs':sourceHash(text)}}))
    await writeFile(join(root,'shared.mjs'),text.replaceAll('\n','\r\n'));await writeFile(join(backend,'shared.mjs'),text)
    assert.equal((await verifySources(root,backend)).comparedBackend,true)
    await writeFile(join(backend,'shared.mjs'),text.replace('1','2'))
    await assert.rejects(()=>verifySources(root,backend),/Backend drift/)
    await rm(join(backend,'shared.mjs'))
    await assert.rejects(()=>verifySources(root,backend),/missing/)
    await writeFile(join(root,'shared.mjs'),text.replace(' = ','='))
    await assert.rejects(()=>verifySources(root),/Local import drift/)
  }finally{if(!resolve(root).startsWith(resolve(prefix)))throw Error('Unexpected test directory');await rm(root,{recursive:true,force:true})}
})
