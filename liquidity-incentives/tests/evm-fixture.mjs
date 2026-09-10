import { readFileSync, readdirSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import solc from 'solc'
import { createPublicClient, createWalletClient, http, encodeFunctionData, parseAbi, keccak256, toHex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { CHAIN_ID, FACTORY, WETH, abi } from '../shared/vault-lifecycle.mjs'
import { anvilBinary } from './anvil.mjs'

export const CASHCAT='0x020bfc650a365f8bb26819deaabf3e21291018b4'
export const POOL='0xa70fc67c9f69da90b63a0e4c05d229954574e313'
let compiled
/** Compile the pinned, test-only source dependency closure once per process. */
function contracts() {
  if(compiled)return compiled
  const root=fileURLToPath(new URL('./protocol/',import.meta.url)),sources={}
  function scan(dir,prefix='') {for(const entry of readdirSync(dir,{withFileTypes:true})) {
    if(entry.isDirectory())scan(dir+'/'+entry.name,prefix+entry.name+'/')
    else if(entry.name.endsWith('.sol'))sources[prefix+entry.name]={content:readFileSync(dir+'/'+entry.name,'utf8')}
  }}
  scan(root)
  const result=JSON.parse(solc.compile(JSON.stringify({language:'Solidity',sources,settings:{optimizer:{enabled:true,runs:200},outputSelection:{'*':{'*':['abi','evm.bytecode.object']}}}}),{
    import:path=>{try{return{contents:readFileSync(new URL('../node_modules/'+path,import.meta.url),'utf8')}}catch{return{error:'Missing test dependency '+path}}},
  }))
  const errors=result.errors?.filter(error=>error.severity==='error')??[]
  if(errors.length)throw new Error(errors.map(error=>error.formattedMessage).join('\n'))
  compiled=result.contracts
  return compiled
}

/** Fresh loopback-only EVM; keys are generated in memory and never logged.
 * The live factory address is occupied only inside this disposable chain.
 */
export async function evmFixture({account=privateKeyToAccount(generatePrivateKey())}={}) {
  const net=createServer();net.listen(0,'127.0.0.1');await once(net,'listening');const port=net.address().port;await new Promise(resolve=>net.close(resolve))
  const child=spawn(anvilBinary(),['--silent','--host','127.0.0.1','--port',String(port),'--chain-id',String(CHAIN_ID)],{stdio:'ignore',windowsHide:true})
  let startError;child.on('error',error=>{startError=error})
  const url='http://127.0.0.1:'+port
  const raw=async(method,params=[])=>{
    const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:1,method,params}),signal:AbortSignal.timeout(5000)})
    const value=await response.json();if(value.error)throw new Error('Local EVM: '+value.error.message);return value.result
  }
  try {
    for(let i=0;i<100;i++){if(startError)throw startError;try{await raw('eth_chainId');break}catch{if(i===99)throw new Error('Test EVM startup failed');await delay(50)}}
    const chain={id:CHAIN_ID,name:'Isolated test',nativeCurrency:{name:'ETH',symbol:'ETH',decimals:18},rpcUrls:{default:{http:[url]}}}
    const client=createPublicClient({chain,transport:http(url),pollingInterval:20})
    const wallet=createWalletClient({account,chain,transport:http(url)})
    await raw('anvil_setBalance',[account.address,toHex(1000n*10n**18n)])
    const artifacts=contracts()
    async function send(to,data,value=0n) {const hash=await wallet.sendTransaction({to,data,value});const receipt=await client.waitForTransactionReceipt({hash});await raw('evm_mine');return receipt}
    async function deploy(file,name,args=[]) {const c=artifacts[file][name];const hash=await wallet.deployContract({abi:c.abi,bytecode:'0x'+c.evm.bytecode.object,args});return(await client.waitForTransactionReceipt({hash})).contractAddress}
    const token=await deploy('Fixture.sol','FixtureToken'),tokenCode=await client.getCode({address:token})
    await raw('anvil_setCode',[CASHCAT,tokenCode]);await raw('anvil_setCode',[WETH,tokenCode])
    const pool=await deploy('Fixture.sol','FixturePool',[CASHCAT,WETH]);await raw('anvil_setCode',[POOL,await client.getCode({address:pool})])
    const manager=await deploy('Fixture.sol','FixturePositionManager',[POOL])
    const factory=await deploy('VaultFactory.sol','VaultFactory',[manager]);await raw('anvil_setCode',[FACTORY,await client.getCode({address:factory})])
    // Copy constructor storage, including Ownable ownership; mappings are empty.
    for(let i=0;i<20;i++)await raw('anvil_setStorageAt',[FACTORY,toHex(i,{size:32}),await raw('eth_getStorageAt',[factory,toHex(i),'latest'])])
    const factoryAbi=artifacts['VaultFactory.sol'].VaultFactory.abi
    const vaultType='0x'+artifacts['UniV3Vault.sol'].UniV3Vault.evm.bytecode.object
    const adapterType='0x'+artifacts['adapters/UniV3FullRangeAdapter.sol'].UniV3FullRangeAdapter.evm.bytecode.object
    await send(FACTORY,encodeFunctionData({abi:factoryAbi,functionName:'addVaultType',args:[vaultType]}))
    await send(FACTORY,encodeFunctionData({abi:factoryAbi,functionName:'addAdapterType',args:[adapterType]}))
    await send(FACTORY,encodeFunctionData({abi:factoryAbi,functionName:'setDefaultDepositTolerance',args:[50n]}))
    const tokenAbi=artifacts['Fixture.sol'].FixtureToken.abi
    for(const t of [CASHCAT,WETH])await send(t,encodeFunctionData({abi:tokenAbi,functionName:'mint',args:[account.address,10n**30n]}))
    const config={chainId:CHAIN_ID,vaultTypeId:1,adapterTypeId:1,confirmations:2,factoryCodeHash:keccak256(await client.getCode({address:FACTORY})),
      vaultTypeHash:keccak256(vaultType),adapterTypeHash:keccak256(adapterType),maxGasPerTx:'15000000',maxGasPriceWei:'100000000000',maxPremiumRaw:(10n**28n).toString()}
    let broadcasts=0,loseBroadcast=false,beforeBroadcast
    const rpc=async(method,params=[])=>{if(method!=='eth_sendRawTransaction')return raw(method,params)
      await beforeBroadcast?.(params[0]);broadcasts++;const hash=await raw(method,params);await raw('evm_mine')
      if(loseBroadcast){loseBroadcast=false;throw new Error('Simulated lost broadcast response')}return hash
    }
    return {account,client,wallet,raw,rpc,send,config,manager,artifacts,abi,tokenAbi,
      get broadcasts(){return broadcasts},set loseBroadcast(value){loseBroadcast=value},set beforeBroadcast(value){beforeBroadcast=value},
      usdQuote:async()=>({priceRaw:(2000n*10n**18n).toString(),checkedAt:Date.now()}),
      close:async()=>{child.kill('SIGTERM');if(child.exitCode===null)await once(child,'exit')},
    }
  } catch(error){child.kill('SIGTERM');throw error}
}
