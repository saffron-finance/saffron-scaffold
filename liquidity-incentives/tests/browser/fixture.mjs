import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn } from 'node:child_process'
import { mkdtemp,writeFile,rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join,resolve,sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createWalletClient,http,hexToString,encodeFunctionData,toHex } from 'viem'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,program,pair } from '../incentives-fixture.mjs'
import { evmFixture,CASHCAT } from '../evm-fixture.mjs'
import { createCreator } from '../../worker/creator.mjs'
import { WETH,abi } from '../../shared/vault-lifecycle.mjs'
import { walletSessionMessage } from '../../shared/incentives.mjs'
import { randomUUID } from 'node:crypto'

/** Actual production server, real PostgreSQL, and real local protocol/Uniswap.
 * Only the injected test wallet and external USD provider are substituted. */
export async function setup(page,{admin=false,wrap=false,campaign=false}={}){
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
  if(!campaign){await store.seed(chain.account.address,10n**30n+'',{pool:chain.pool})
    for(const days of [7,14,30])await database.saveProgram({...program,id:'cashcat-'+days+'d',days},chain.account.address)}
  await chain.raw('anvil_setBalance',[account.address,toHex(100n*10n**18n)])
  for(const token of [CASHCAT,...(wrap?[]:[WETH])])await chain.send(token,encodeFunctionData({abi:chain.tokenAbi,functionName:'mint',args:[account.address,10n**26n]}))
  const worker=createCreator({database,rpc:chain.rpc,account:chain.account,config:chain.config})
  if(!campaign){await database.execution.heartbeat(chain.account.address)
    await chain.prepareIntake(database,{continuous:true})
    const heart=setInterval(()=>void database.execution.heartbeat(chain.account.address).catch(()=>{}),5000)
    cleanup.push(()=>clearInterval(heart))}
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
    SAFFRON_CREATION_FEE_RECIPIENT:chain.feeRecipient,PRICE_API_ROOT:'http://127.0.0.1:'+price.address().port,SAFFRON_ADMIN_WALLETS:admin?account.address:chain.account.address,
    PGHOST:conn.host,PGPORT:String(conn.port),PGUSER:conn.user,PGPASSWORD:conn.password,PGDATABASE:conn.database}})
  cleanup.push(async()=>{if(child.exitCode===null){child.kill();await once(child,'exit')}})
  let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk})
  for(let i=0;i<100;i++){try{if((await fetch(origin+'/')).ok)break}catch{}if(i===99)throw new Error('Application startup failed: '+output);await delay(100)}
  let operatorSession
  const operatorAccount=admin?account:chain.account
  async function operatorCall(path,body){
    const call=async(path,body)=>{const response=await fetch(origin+'/api/incentives'+path,{method:body?'POST':'GET',headers:{origin,'content-type':'application/json',...(operatorSession?{cookie:operatorSession.cookie,'x-saffron-csrf':operatorSession.csrf}:{})},...(body?{body:JSON.stringify(body)}:{})});return {response,data:await response.json()}}
    if(!operatorSession){const challenge=(await call('/session/challenge',{wallet:operatorAccount.address})).data
      const result=await call('/session/login',{wallet:operatorAccount.address,nonce:challenge.nonce,signature:await operatorAccount.signMessage({message:walletSessionMessage(challenge)})})
      if(!result.response.ok)throw new Error('Fixture operator login failed')
      operatorSession={cookie:result.response.headers.get('set-cookie').split(';')[0],csrf:result.data.session.csrf}}
    const result=await call(path,body);if(!result.response.ok)throw new Error(result.data.error);return result.data
  }
  let treasury,treasuryWallet
  if(campaign){
    if((await operatorCall('/admin/catalog')).programs.length)throw new Error('Production bootstrap must start empty')
    await operatorCall('/admin/pairs',{...pair,pool:chain.pool})
    await operatorCall('/admin/campaigns',{id:'cashcat-3d',name:'Complete-cycle campaign',pairId:pair.id,days:3,budgetUsd:'1000',capacityUsd:'100000',active:true})
    treasury=privateKeyToAccount(generatePrivateKey());treasuryWallet=createWalletClient({account:treasury,chain:chain.client.chain,transport:http(chain.url)})
    await chain.raw('anvil_setBalance',[treasury.address,toHex(10n**20n)])
    await chain.send(CASHCAT,encodeFunctionData({abi:chain.tokenAbi,functionName:'mint',args:[treasury.address,10n**30n]}))
    await operatorCall('/admin/treasury',{budgetId:'cashcat-3d',wallet:treasury.address,limitRaw:(10n**29n).toString(),revision:0,reason:'Assign complete-cycle test inventory',requestKey:randomUUID()})
    await chain.prepareIntake(database,{continuous:true})
  }
  async function fund(row,rawAmount){
    if(!treasuryWallet)return chain.fund(row)
    const bearer=await chain.client.readContract({address:row.plan.vault,abi,functionName:'variableBearerToken'})
    const supplied=await chain.client.readContract({address:bearer,abi,functionName:'totalSupply'}),amount=rawAmount??BigInt(row.plan.premium)-supplied
    const receipts=[]
    for(const [to,data]of [[CASHCAT,encodeFunctionData({abi,functionName:'approve',args:[row.plan.vault,amount]})],[row.plan.vault,encodeFunctionData({abi,functionName:'deposit',args:[amount,1n,'0x']})]]){
      const hash=await treasuryWallet.sendTransaction({to,data}),receipt=await chain.client.waitForTransactionReceipt({hash});await chain.raw('evm_mine');receipts.push({hash,blockNumber:receipt.blockNumber.toString(),blockHash:receipt.blockHash})}
    return receipts
  }
  const wallet=createWalletClient({account,chain:chain.client.chain,transport:http(chain.url)})
  const state={chain:'0x1237',sends:0,signs:0,calls:[],messages:[],lostSend:false,lastHash:null,connected:false,holdSend:false}
  await page.context().exposeFunction('fixtureWalletRequest',async(name,{method,params=[]})=>{
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
  await page.context().addInitScript(() => {
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

  await page.context().addInitScript(()=>{const actual=Date.now;window.testClockOffset=Number(localStorage.getItem('saffron.fixture.clock-offset')||0);Date.now=()=>actual()+window.testClockOffset})
  return {account,chain,database,worker,state,origin,operatorCall,fund,treasuryAddress:treasury?.address,
    async advanceTo(timestamp){clockOffset=timestamp*1000-Date.now();await writeFile(clockFile,String(clockOffset));await page.evaluate(value=>{window.testClockOffset=value;localStorage.setItem('saffron.fixture.clock-offset',String(value))},clockOffset);await chain.raw('evm_setNextBlockTimestamp',[timestamp]);await chain.raw('evm_mine');await chain.raw('evm_mine')},
    close,
  }
  }catch(error){await close();throw error}
}
export async function connect(page){await page.getByRole('button',{name:'Connect wallet',exact:true}).first().click();await page.getByRole('button',{name:'Uniswap Extension',exact:true}).click()}
