import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { writeFile,symlink } from 'node:fs/promises'
import { join } from 'node:path'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { protectedRpc,protectedValue,loadSigner } from '../worker/protected-config.mjs'
import { readOperatorConfig } from '../worker/config.mjs'
import { privateFilesFixture,setFixtureAccess } from './private-files-fixture.mjs'

it('private RPC bounds concurrency, retries throttled reads, never retries a send, and hides provider diagnostics',async()=>{
  let calls=0,active=0,peak=0,sendCalls=0
  const server=createServer(async(req,res)=>{
    let data='';for await(const chunk of req)data+=chunk
    const body=JSON.parse(data)
    if(body.method==='eth_sendRawTransaction'){
      sendCalls++;res.writeHead(503,{'content-type':'application/json'});res.end(JSON.stringify({id:1,error:{code:-32000,message:'DO_NOT_LEAK provider diagnostics'}}));return
    }
    calls++;active++;peak=Math.max(peak,active);await delay(20);active--
    if(calls===1){res.writeHead(429,{'content-type':'application/json'});res.end(JSON.stringify({id:1,error:{code:-32005,message:'throttled'}}));return}
    res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({jsonrpc:'2.0',id:1,result:'0x1237'}))
  })
  server.listen(0,'127.0.0.1');await once(server,'listening')
  try{
    const rpc=await protectedRpc({rpcUrl:'http://127.0.0.1:'+server.address().port,readOnly:false})
    assert.equal(await rpc('eth_chainId'), '0x1237');assert.equal(calls,2)
    await Promise.all(Array.from({length:8},()=>rpc('eth_chainId')))
    assert.ok(peak<=2)
    await assert.rejects(rpc('eth_sendRawTransaction',['test-only-invalid-bytes']),error=>!error.message.includes('DO_NOT_LEAK')&&/RPC operation unavailable/.test(error.message))
    assert.equal(sendCalls,1)
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
})

it('signer credentials require private regular files and exact public identity',{timeout:30000},async()=>{
  const files=await privateFilesFixture('saffron-credential-test-'),{directory}=files,file=join(directory,"ephemeral [fixture] O'Brien $; café"),link=join(directory,'link')
  // Generated fixture only: never funded or sent to any RPC; removed in finally.
  const key=generatePrivateKey(),account=privateKeyToAccount(key)
  try{
    await writeFile(file,key,{mode:0o600})
    assert.equal((await loadSigner({signerCredentialFile:file,signerAddress:account.address})).address,account.address)
    await assert.rejects(loadSigner({signerCredentialFile:file,signerAddress:'0x'+'1'.repeat(40)}),/mismatch/)
    await setFixtureAccess(file,'readable');await assert.rejects(loadSigner({signerCredentialFile:file,signerAddress:account.address}),/owner-only/)
    await setFixtureAccess(file,'private')
    // Directory junctions do not require Windows symlink privileges. Both must
    // fail the same regular-file boundary before any credential is read.
    await symlink(process.platform==='win32'?directory:file,link,process.platform==='win32'?'junction':'file')
    await assert.rejects(protectedValue({file:link}),/regular file/)
    for(const passEntry of ['../entry','entry;bad','entry\nsecond'])await assert.rejects(protectedValue({passEntry}),/Invalid protected entry/)
  }finally{await files.close()}
})

it('operator activation and one-vault policy are explicit and fail closed',async()=>{
  const files=await privateFilesFixture('saffron-config-test-'),file=join(files.directory,'config.json')
  const base={enabled:true,chainId:4663,signerAddress:'0x'+'1'.repeat(40),factoryCodeHash:'0x'+'2'.repeat(64),vaultTypeHash:'0x'+'3'.repeat(64),adapterTypeHash:'0x'+'4'.repeat(64),
    vaultTypeId:1,adapterTypeId:2,maxGasPerTx:'1000',maxGasPriceWei:'1000',maxPremiumRaw:'1000',maxDailyGasWei:'1000000',confirmations:2,
    database:{host:'/private/test/socket',user:'test',database:'test'},mode:'one-request',maxVaults:1,requestId:'11111111-1111-4111-8111-111111111111',simulationFile:'/private/simulation.json',stateDirectory:'/private/state'}
  try{
    await writeFile(file,JSON.stringify(base),{mode:0o600});assert.equal((await readOperatorConfig(file,{oneRequest:true})).maxVaults,1)
    const invalid=[{enabled:false},{chainId:1},{factory:'0x'+'9'.repeat(40)},{maxVaults:2},{mode:'queue'},{confirmations:1},{maxGasPerTx:0},{maxDailyGasWei:-1},{factoryCodeHash:'0x'},{simulationFile:null},{stateDirectory:null},{database:null},{requestId:'-'.repeat(36)},{stateDirectory:'relative'}]
    for(const change of invalid){await writeFile(file,JSON.stringify({...base,...change}));await assert.rejects(readOperatorConfig(file,{oneRequest:true}))}
    await writeFile(file,JSON.stringify(base));await setFixtureAccess(file,'readable')
    assert.equal((await readOperatorConfig(file,{oneRequest:true})).maxVaults,1,'public read access does not authorize config writes')
    await setFixtureAccess(file,'writable');await assert.rejects(readOperatorConfig(file,{oneRequest:true}),/non-writable/)
  }finally{await files.close()}
})
