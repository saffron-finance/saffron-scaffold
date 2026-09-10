import { readFile, stat } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { privateKeyToAccount } from 'viem/accounts'
import { parseUnits } from 'viem'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'
import { createCreator } from './creator.mjs'
import { CHAIN_ID, sameAddress } from '../shared/vault-lifecycle.mjs'

/** Operator-owned config contains references, never a plaintext key. The host
 * supplies a read-only credential file from its protected/masked secret store.
 */
async function main() {
  const configPath = process.argv[2]
  if (!configPath || process.argv.some(value => /^0x[0-9a-f]{64}$/i.test(value))) throw new Error('Use a local config path, never credentials in arguments.')
  const config = JSON.parse(await readFile(configPath,'utf8'))
  if (config.chainId !== CHAIN_ID || !config.enabled) throw new Error('Robinhood creator must be explicitly enabled in operator config.')
  for (const name of ['factoryCodeHash','vaultTypeHash','adapterTypeHash']) if (!/^0x[0-9a-f]{64}$/i.test(config[name] ?? '')) throw new Error('Configure verified factory/type hashes first.')
  for (const name of ['vaultTypeId','adapterTypeId','maxGasPerTx','maxGasPriceWei','maxPremiumRaw','maxDailyGasWei']) if (!/^[1-9][0-9]*$/.test(String(config[name] ?? ''))) throw new Error('Invalid positive operator limit.')
  if (!Number.isInteger(config.confirmations) || config.confirmations < 2) throw new Error('At least two confirmations are required.')
  const info = await stat(config.signerCredentialFile)
  if (!info.isFile() || (info.mode & 0o077) || info.size > 256) throw new Error('Signer credential must be a protected, owner-only file.')
  const credential = await readFile(config.signerCredentialFile)
  let account
  try { account = privateKeyToAccount(credential.toString('utf8').trim()) }
  finally { credential.fill(0) }
  if (!sameAddress(account.address, config.signerAddress)) throw new Error('Protected signer does not match configured public address.')
  // No RPC URL, secret, raw transaction, or provider error enters stdout.
  const rpc = async (method, params) => {
    const response = await fetch(config.rpcUrl,{method:'POST',headers:{'content-type':'application/json'},
      body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(20_000)})
    const body = await response.json()
    if (!response.ok || body.error) throw new Error('RPC operation unavailable')
    return body.result
  }
  const priceRoot = new URL(config.priceApi)
  if (priceRoot.username || priceRoot.password || priceRoot.search || priceRoot.hash) throw new Error('Invalid price service reference')
  const usdQuote = async address => {
    const response = await fetch(priceRoot.href.replace(/\/$/,'') + '/' + address,{signal:AbortSignal.timeout(15_000),redirect:'error'})
    const value = await response.json()
    if (!response.ok || !value.success || !sameAddress(value.data?.tokenAddress,address) || value.data.chainId !== CHAIN_ID
      || !Number.isFinite(value.data.price) || value.data.price <= 0) throw new Error('USD quote unavailable')
    return {priceRaw:parseUnits(value.data.price.toFixed(18),18).toString(),checkedAt:Date.parse(value.data.timestamp)}
  }
  const database = createIncentivesDatabase({ connection: config.database })
  const worker = createCreator({database,rpc,account,config,usdQuote})
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
