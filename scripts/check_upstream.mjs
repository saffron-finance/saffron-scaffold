import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Verify exact imported production hooks/helpers and optionally flag drift in a
 * newer canonical checkout. Adapted presentation files require human review. */
const root=fileURLToPath(new URL('../',import.meta.url))
const manifest=JSON.parse(await readFile(resolve(root,'docs/upstream-sync.json')))
const hash=bytes=>createHash('sha256').update(bytes).digest('hex')
const failures=[]
for(const [file,expected] of Object.entries(manifest.exactFiles)){
  if(hash(await readFile(resolve(root,file)))!==expected)failures.push('Local import changed: '+file)
  if(process.argv[2]&&hash(await readFile(resolve(process.argv[2],file)))!==expected)failures.push('Upstream drift: '+file)
}
if(failures.length)throw new Error(failures.join('\n'))
console.log(JSON.stringify({ok:true,backendCommit:manifest.backendCommit,exactFiles:Object.keys(manifest.exactFiles).length,comparedUpstream:Boolean(process.argv[2])}))
