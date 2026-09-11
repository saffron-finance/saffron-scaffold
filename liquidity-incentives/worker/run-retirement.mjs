import { readOperatorConfig } from './config.mjs'
import { protectedRpc } from './protected-config.mjs'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'
import { runRetirement } from './retire-request.mjs'
async function main(){
  if(process.argv.length!==3)throw new Error('Use one retirement configuration file.')
  const config=await readOperatorConfig(process.argv[2])
  if(config.mode!=='retire-request'||!/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(config.requestId??'')||!/^0x[0-9a-f]{64}$/i.test(config.planHash??''))throw new Error('Pin the retired request and plan.')
  const rpc=await protectedRpc({...config,readOnly:false}),database=createIncentivesDatabase({connection:config.database})
  try{console.log(JSON.stringify(await runRetirement({database,rpc,config,requestId:config.requestId,planHash:config.planHash})))}finally{await database.close()}
}
main().catch(()=>{console.error('Pinned retirement stopped. Inspect external recovery and the saved transaction journal.');process.exitCode=1})
