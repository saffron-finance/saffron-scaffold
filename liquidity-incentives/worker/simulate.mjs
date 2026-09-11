import { readFile,writeFile } from 'node:fs/promises'
import { protectedRpc } from './protected-config.mjs'
import { simulateFactory } from './fork-simulate.mjs'

/** A config plus a public immutable job export produces a reviewable simulation
 * artifact. Disabled configs are accepted: simulation must precede activation.
 * Unlike run-one, this entry point never resolves a protected signing key. */
async function main(){
  if(process.argv.length!==5)throw new Error('Use config, public job, and output paths.')
  const config=JSON.parse(await readFile(process.argv[2],'utf8')),input=JSON.parse(await readFile(process.argv[3],'utf8'))
  const job=input.job??input
  if(config.chainId!==4663||!job.plan||!job.snapshot||!job.plan_hash||!job.intent_id)throw new Error('A complete reviewed deployment plan is required.')
  const upstream=await protectedRpc({...config,readOnly:true})
  const result=await simulateFactory({upstream,config,job})
  await writeFile(process.argv[4],JSON.stringify(result,null,2)+'\n',{flag:'wx',mode:0o600})
  console.log(JSON.stringify({ok:true,requestId:result.requestId,chainId:result.chainId,forkBlockNumber:result.forkBlockNumber,localTransactions:result.transactions.length,upstreamBroadcasts:0}))
}
main().catch(()=>{console.error('Read-only factory simulation failed; live execution remains disabled.');process.exitCode=1})
