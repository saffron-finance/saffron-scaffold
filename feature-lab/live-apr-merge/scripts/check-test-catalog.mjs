import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {resolve,relative} from 'node:path'

/** Validate bookkeeping, not application behavior. A catalog match alone must
 * never become a green semantic-contract count or satisfy the 500-test gate. */
const root=fileURLToPath(new URL('../',import.meta.url))
const catalog=JSON.parse(await readFile(resolve(root,'docs/test-contract-catalog.json'),'utf8'))
const seen=new Set(),counts={}
for(const contract of catalog.contracts){
  if(!/^(FE|APR|BE|SEC)-[A-Z]+-\d{3}$/.test(contract.id)||seen.has(contract.id))throw Error('Invalid/duplicate contract: '+contract.id)
  seen.add(contract.id)
  if(!Object.hasOwn(catalog.statusDefinitions,contract.status))throw Error('Unknown status: '+contract.id)
  if(contract.semanticCoverageVerified!==false)throw Error('Semantic credit needs a reviewed evidence gate: '+contract.id)
  if(Boolean(contract.testReferences.length)!==(contract.status==='test-linked'))throw Error('Reference/status mismatch: '+contract.id)
  for(const ref of contract.testReferences){
    const path=resolve(root,ref.file)
    if(relative(root,path).startsWith('..'))throw Error('Reference leaves package: '+contract.id)
    const line=(await readFile(path,'utf8')).split('\n')[ref.line-1]??''
    if(!line.includes(contract.id)&&!line.includes(contract.id.replaceAll('-','_')))throw Error('Stale test reference: '+contract.id+' '+ref.file)
  }
  counts[contract.status]=(counts[contract.status]??0)+1
}
console.log(JSON.stringify({catalogEntries:seen.size,statuses:counts,semanticContractsClaimed:0}))
