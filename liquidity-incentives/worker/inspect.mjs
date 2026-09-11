import { readFile } from 'node:fs/promises'
import { decodeFunctionResult, encodeFunctionData, keccak256 } from 'viem'
import { abi, CHAIN_ID, FACTORY } from '../shared/vault-lifecycle.mjs'
import { protectedRpc } from './protected-config.mjs'

/** Read-only operator inspection. Config contains references, never an EOA.
 * Results are public bytecode hashes/IDs; no provider URL or errors are echoed.
 */
async function main() {
  const config=JSON.parse(await readFile(process.argv[2],'utf8'))
  const rpc=await protectedRpc({...config,readOnly:true})
  if(BigInt(await rpc('eth_chainId',[]))!==BigInt(CHAIN_ID))throw new Error('Wrong chain')
  const block=await rpc('eth_getBlockByNumber',['latest',false])
  if(Date.now()-Number(BigInt(block.timestamp))*1000>60000)throw new Error('Stale chain')
  const code=await rpc('eth_getCode',[FACTORY,block.number])
  const read=async(name,id)=>decodeFunctionResult({abi,functionName:name,data:await rpc('eth_call',[{to:FACTORY,data:encodeFunctionData({abi,functionName:name,args:[BigInt(id)]})},block.number])})
  const vault=await read('vaultTypeByteCode',config.vaultTypeId),adapter=await read('adapterTypeByteCode',config.adapterTypeId)
  if([code,vault,adapter].includes('0x'))throw new Error('Missing factory or registered type')
  if((await rpc('eth_getBlockByNumber',[block.number,false])).hash!==block.hash)throw new Error('Noncanonical block')
  console.log(JSON.stringify({chainId:CHAIN_ID,factory:FACTORY,blockNumber:block.number,blockHash:block.hash,
    vaultTypeId:config.vaultTypeId,adapterTypeId:config.adapterTypeId,factoryCodeHash:keccak256(code),vaultTypeHash:keccak256(vault),adapterTypeHash:keccak256(adapter)},null,2))
}
main().catch(()=>{console.error('Read-only inspection failed. Check chain, registered IDs and protected RPC configuration.');process.exitCode=1})
