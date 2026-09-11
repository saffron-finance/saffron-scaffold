import { readOperatorConfig } from './config.mjs'
import { protectedRpc } from './protected-config.mjs'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'
import { freezeRestoredDatabase,inspectRestoredDatabase } from '../server/restore-verification.mjs'

async function main(){
  if(process.argv.length!==4||!['freeze','inspect'].includes(process.argv[2]))throw new Error('Use freeze or inspect with one protected configuration file.')
  const config=await readOperatorConfig(process.argv[3],{readOnly:true}),db=createIncentivesDatabase({connection:config.database})
  try{
    if(process.argv[2]==='freeze'){await freezeRestoredDatabase(db);console.log('Restored campaigns and intake are paused pending reconciliation.');return}
    console.log(JSON.stringify(await inspectRestoredDatabase({db,rpc:await protectedRpc({...config,readOnly:true}),confirmations:config.confirmations}),null,2))
  }finally{await db.close()}
}
main().catch(()=>{console.error('Restore verification failed; keep signer processes stopped and intake paused.');process.exitCode=1})
