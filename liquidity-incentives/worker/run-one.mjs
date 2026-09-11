import { readFile } from 'node:fs/promises'
import { readOperatorConfig } from './config.mjs'
import { protectedRpc,loadSigner } from './protected-config.mjs'
import { runOneRequest } from './one-shot.mjs'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'

/** Explicit one-vault command. No service loop, implicit queue selection, funding,
 * retirement, or automatic new attempt. Errors never serialize credentials. */
async function main(){
  if(process.argv.length!==3)throw new Error('Use exactly one operator config file.')
  const config=await readOperatorConfig(process.argv[2],{oneRequest:true})
  const simulation=JSON.parse(await readFile(config.simulationFile,'utf8'))
  const rpc=await protectedRpc({...config,readOnly:false})
  const database=createIncentivesDatabase({connection:config.database})
  try{
    await database.ready
    // The account object is never passed to an HTTP handler or Anvil process.
    const account=await loadSigner(config)
    const result=await runOneRequest({database,rpc,account,config,requestId:config.requestId,
      simulation,directory:config.stateDirectory,
      onProgress:result=>console.log(JSON.stringify(result))})
    console.log(JSON.stringify(result))
  }finally{await database.close()}
}
main().catch(()=>{console.error('One-request execution stopped. Inspect the protected journal and one-shot state; no new attempt is authorized.');process.exitCode=1})
