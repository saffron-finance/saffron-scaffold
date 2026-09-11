import { readFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'
import { protectedRpc } from './protected-config.mjs'
import { createPaymentWatcher } from './payments.mjs'
import { assertProtectedPath } from './protected-files.mjs'

/** Keyless payment detection supervisor. --once means one bounded scan only;
 * this command never owns the deployment signer or authorizes a gas spend. */
async function main(){
  if(process.argv.length<3||process.argv.length>4||(process.argv[3]&&process.argv[3]!=='--once'))throw new Error('Use a payment config file and optional --once.')
  await assertProtectedPath(process.argv[2],{privateAccess:false,maxBytes:65536,message:'Payment watcher configuration must be a protected regular file.'})
  const config=JSON.parse(await readFile(process.argv[2],'utf8'))
  if(config.enabled!==true||config.chainId!==4663||config.mode!=='payments')throw new Error('Explicit payment watcher activation is required.')
  const rpc=await protectedRpc({...config,readOnly:true}),database=createIncentivesDatabase({connection:config.database})
  let stop=false;process.on('SIGINT',()=>{stop=true});process.on('SIGTERM',()=>{stop=true})
  try{
    const watcher=createPaymentWatcher({database,rpc,startBlock:config.startBlock,confirmations:config.confirmations,maxBlocks:config.maxBlocks??50,id:config.watcherId??'native-eth-v1'})
    do{console.log(JSON.stringify(await watcher.tick()));if(process.argv.includes('--once'))break;if(!stop)await delay(2000)}while(!stop)
  }finally{await database.close()}
}
main().catch(()=>{console.error('Keyless payment watcher stopped; checkpoint retained. Check RPC/database health and operator policy.');process.exitCode=1})
