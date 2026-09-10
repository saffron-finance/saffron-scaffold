import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve,sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createWalletClient,http,hexToString,encodeFunctionData,toHex } from 'viem'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,program } from '../incentives-fixture.mjs'
import { evmFixture,CASHCAT } from '../evm-fixture.mjs'
import { createCreator } from '../../worker/creator.mjs'
import { WETH } from '../../shared/vault-lifecycle.mjs'

/** Actual production server, real PostgreSQL, and real local protocol/Uniswap.
 * Only the injected test wallet and external USD provider are substituted. */
export async function setup(page,{admin=false,wrap=false}={}){
  const cleanup=[];let closing
  const close=()=>closing??=(async()=>{let failure;for(const release of cleanup.reverse()){try{await release()}catch(error){failure??=error}}if(failure)throw failure})()
  try{
  const account=privateKeyToAccount(generatePrivateKey()),chain=await evmFixture({realPositionManager:true})
  cleanup.push(()=>chain.close())
  const store=await incentivesFixture(),database=store.database
  cleanup.push(()=>store.close())
  const dir=await mkdtemp(join(tmpdir(),'saffron-incentives-test-')),clockFile=join(dir,'clock.txt')
  cleanup.push(async()=>{const resolved=resolve(dir);if(!resolved.startsWith(resolve(tmpdir())+sep+'saffron-incentives-test-'))throw new Error('Unsafe fixture cleanup path');await rm(resolved,{recursive:true,force:true})})
  await writeFile(clockFile,'0')
  await store.seed(chain.account.address,10n**30n+'',{pool:chain.pool})
  for(const days of [7,14,30])await database.saveProgram({...program,id:'cashcat-'+days+'d',days},chain.account.address)
  await chain.raw('anvil_setBalance',[account.address,toHex(100n*10n**18n)])
  for(const token of [CASHCAT,...(wrap?[]:[WETH])])await chain.send(token,encodeFunctionData({abi:chain.tokenAbi,functionName:'mint',args:[account.address,10n**26n]}))
  const worker=createCreator({database,rpc:chain.rpc,account:chain.account,config:chain.config})
  await database.execution.heartbeat(chain.account.address)
  const heart=setInterval(()=>void database.execution.heartbeat(chain.account.address).catch(()=>{}),5000)
  cleanup.push(()=>clearInterval(heart))
  let clockOffset=0
  const price=createServer((req,res)=>{const address=new URL(req.url,'http://localhost').pathname.split('/')[1];res.setHeader('content-type','application/json');res.end(JSON.stringify({success:true,data:{chainId:4663,tokenAddress:address,currency:'usd',price:2000,timestamp:new Date(Date.now()+clockOffset).toISOString()}}))})
  price.listen(0,'127.0.0.1');await once(price,'listening')
  cleanup.push(()=>new Promise(r=>price.close(r)))
  const portReservation=createServer();portReservation.listen(0,'127.0.0.1');await once(portReservation,'listening');const port=portReservation.address().port;await new Promise(r=>portReservation.close(r))
  const origin='http://127.0.0.1:'+port,protocolFile=join(dir,'protocol.json')
  await writeFile(protocolFile,JSON.stringify({...chain.config,signerAddress:chain.account.address}))
  const conn=store.connection
  const child=spawn(process.execPath,['--import','./tests/clock-env.mjs','server/proxy.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'test',SAFFRON_TEST_CLOCK_FILE:clockFile,
    SAFFRON_API_DISABLED:'',PORT:String(port),BASE_PATH:'',RPC_ROBINHOOD:chain.url,SAFFRON_APP_ORIGIN:origin,SAFFRON_PROTOCOL_CONFIG:protocolFile,
    PRICE_API_ROOT:'http://127.0.0.1:'+price.address().port,SAFFRON_ADMIN_WALLETS:admin?account.address:chain.account.address,
    PGHOST:conn.host,PGPORT:String(conn.port),PGUSER:conn.user,PGPASSWORD:conn.password,PGDATABASE:conn.database}})
  cleanup.push(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit')}})
  let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/')).ok)break}catch{}if(i===99)throw new Error('Application startup failed: '+output);await delay(100)}
  const wallet=createWalletClient({account,chain:chain.client.chain,transport:http(chain.url)})
  const state={chain:'0x1237',sends:0,signs:0,calls:[],messages:[],lostSend:false,lastHash:null,connected:false,holdSend:false}
  await page.exposeFunction('fixtureWalletRequest',async(name,{method,params=[]})=>{
    state.calls.push(method)
    if(method==='eth_requestAccounts'){state.connected=true;return [account.address]}
    if(method==='eth_accounts')return state.connected?[account.address]:[]
    if(method==='eth_chainId')return state.chain
    if(method==='wallet_switchEthereumChain'){state.chain=params[0].chainId;return null}
    if(method==='wallet_addEthereumChain')return null
    if(method==='wallet_getCapabilities')return {}
    if(method==='personal_sign'){state.signs++;state.messages.push(hexToString(params[0]));return account.signMessage({message:hexToString(params[0])})}
    if(method==='eth_signTypedData_v4'){state.signs++;return account.signTypedData(JSON.parse(params[1]))}
    if(method==='eth_sendTransaction'){
      const tx=params[0];state.sends++
      if(state.holdSend)await new Promise(r=>{state.releaseSend=r})
      const hash=await wallet.sendTransaction({to:tx.to,data:tx.data,value:BigInt(tx.value??0),...(tx.nonce?{nonce:Number(BigInt(tx.nonce))}:{})})
      state.lastHash=hash;await chain.raw('evm_mine')
      if(state.lostSend){state.lostSend=false;throw new Error('Simulated lost wallet response')}
      return hash
    }
    return chain.raw(method,params)
  })
  await page.addInitScript(() => {
    const makeProvider = (name) => {
      const listeners = new Map()
      return {
        isMetaMask: name === 'MetaMask',
        request: async (args) => {
          const result = await window.fixtureWalletRequest(name, args)
          if (args.method === 'wallet_switchEthereumChain') for (const callback of listeners.get('chainChanged') ?? []) callback(args.params[0].chainId)
          return result
        },
        on: (name, handler) => listeners.set(name, [...(listeners.get(name) ?? []), handler]),
        removeListener: (name, handler) => listeners.set(name, (listeners.get(name) ?? []).filter((item) => item !== handler)),
      }
    }
    const metamask = makeProvider('MetaMask')
    const uniswap = makeProvider('Uniswap Extension')
    window.ethereum = metamask
    // New UUIDs on each reload exercise stable persisted RDNS selection.
    const wallets = [
      { provider: metamask, info: { uuid: crypto.randomUUID(), rdns: 'io.metamask', name: 'MetaMask', icon: '' } },
      { provider: uniswap, info: { uuid: crypto.randomUUID(), rdns: 'org.uniswap', name: 'Uniswap Extension', icon: '' } },
    ]
    window.addEventListener('eip6963:requestProvider', () => {
      for (const detail of wallets) window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail }))
    })
  })

  await page.addInitScript(()=>{const actual=Date.now;window.testClockOffset=Number(localStorage.getItem('saffron.fixture.clock-offset')||0);Date.now=()=>actual()+window.testClockOffset})
  return {account,chain,database,worker,state,origin,
    async advanceTo(timestamp){clockOffset=timestamp*1000-Date.now();await writeFile(clockFile,String(clockOffset));await page.evaluate(value=>{window.testClockOffset=value;localStorage.setItem('saffron.fixture.clock-offset',String(value))},clockOffset);await chain.raw('evm_setNextBlockTimestamp',[timestamp]);await chain.raw('evm_mine');await chain.raw('evm_mine')},
    close,
  }
  }catch(error){await close();throw error}
}
export async function connect(page){await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.getByRole('button',{name:'Uniswap Extension',exact:true}).click()}
