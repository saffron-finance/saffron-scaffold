import { readFile } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import { assertProtectedPath } from './protected-files.mjs'
import { CHAIN_ID,FACTORY,sameAddress } from '../shared/vault-lifecycle.mjs'

/** Validate the operator file before resolving any signer or private RPC entry.
 * Live one-request operation is deliberately separate from ordinary queue mode. */
export async function readOperatorConfig(file,{oneRequest=false,readOnly=false}={}){
  if(typeof file!=='string'||!file||/^0x[0-9a-f]{64}$/i.test(file))throw new Error('Use an operator config path.')
  await assertProtectedPath(file,{privateAccess:false,maxBytes:65536,message:'Operator config must be a non-writable-by-others regular file.'})
  const config=JSON.parse(await readFile(file,'utf8'))
  if(config.chainId!==CHAIN_ID||!readOnly&&config.enabled!==true||!sameAddress(config.factory??FACTORY,FACTORY))throw new Error('Explicit Robinhood factory activation is required.')
  if(!/^0x[0-9a-f]{40}$/i.test(config.signerAddress??''))throw new Error('Configure the public signer address.')
  for(const name of ['factoryCodeHash','vaultTypeHash','adapterTypeHash'])if(!/^0x[0-9a-f]{64}$/i.test(config[name]??''))throw new Error('Verified factory/type hashes are required.')
  for(const name of ['vaultTypeId','adapterTypeId','maxGasPerTx','maxGasPriceWei','maxPremiumRaw','maxDailyGasWei'])if(!/^[1-9][0-9]*$/.test(String(config[name]??'')))throw new Error('Positive execution limits are required.')
  if(!Number.isInteger(config.confirmations)||config.confirmations<2)throw new Error('At least two confirmations are required.')
  if(!config.database||['host','user','database'].some(key=>typeof config.database[key]!=='string'||!config.database[key]))throw new Error('An explicit operator database connection is required.')
  if(oneRequest&&(config.mode!=='one-request'||config.maxVaults!==1||!/^([0-9a-f]{8}-)([0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(config.requestId??'')
    ||typeof config.simulationFile!=='string'||!isAbsolute(config.simulationFile)||typeof config.stateDirectory!=='string'||!isAbsolute(config.stateDirectory)))throw new Error('A pinned request, passing simulation and one-vault state directory are required.')
  return config
}
