import { setTimeout as delay } from 'node:timers/promises'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'
import { createCreator } from './creator.mjs'
import { readOperatorConfig } from './config.mjs'
import { protectedRpc,loadSigner } from './protected-config.mjs'

/** Operator-owned config contains references, never a plaintext key. The host
 * supplies a read-only credential file from its protected/masked secret store.
 */
async function main() {
  const configPath = process.argv[2]
  if (!configPath||process.argv.length>4||(process.argv[3]&&process.argv[3]!=='--once')||process.argv.some(value => /^0x[0-9a-f]{64}$/i.test(value))) throw new Error('Use a local config path and optional --once, never credentials in arguments.')
  const config = await readOperatorConfig(configPath)
  // A one-vault permit can never be fed to the unconstrained queue loop.
  if(config.mode==='one-request'||config.maxVaults)throw new Error('Use worker:one for a one-request permit.')
  const account=await loadSigner(config)
  const rpc=await protectedRpc({...config,readOnly:false})
  const database = createIncentivesDatabase({ connection: config.database })
  const worker = createCreator({database,rpc,account,config})
  let stopped = false
  process.on('SIGINT',()=>{stopped=true});process.on('SIGTERM',()=>{stopped=true})
  let heartbeat
  try {
    await database.ready
    heartbeat = setInterval(() => { void database.execution.heartbeat(account.address).catch(() => {}) }, 5000)
    heartbeat.unref()
    do {
      const result = await worker.tick()
      console.log(JSON.stringify(result))
      if (process.argv.includes('--once')) break
      if (!stopped) await delay(5000)
    } while(!stopped)
  } finally { clearInterval(heartbeat); await database.close() }
}
main().catch(()=>{ console.error('Creator stopped: check protected configuration and service health. No credentials were logged.');process.exitCode=1 })
