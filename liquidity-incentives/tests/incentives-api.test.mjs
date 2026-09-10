import { proofHash,paymentData } from '../shared/payment.mjs'
import { randomBytes } from 'node:crypto'
import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import net from 'node:net'
import { setTimeout as delay } from 'node:timers/promises'
import { once } from 'node:events'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createWalletAuth } from '../server/wallet-auth.mjs'
import { createIncentivesHandler } from '../server/incentives-api.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { createIncentivesDatabase } from '../server/incentives-database.mjs'
import { walletSessionMessage } from '../shared/incentives.mjs'

it('HTTP wallet authorization, atomic replay, privacy, CSRF and separate operator permissions',async()=>{
  const store=await incentivesFixture(),db=store.database
  const user=privateKeyToAccount(generatePrivateKey()),admin=privateKeyToAccount(generatePrivateKey()),stranger=privateKeyToAccount(generatePrivateKey())
  await store.seed(admin.address)
  const auth=createWalletAuth({origin:ORIGIN,basePath:'/app',operators:[admin.address]})
  const proofs=new Map()
  // Canonical RPC fixture exercises the verifier through the real HTTP boundary.
  const rpc=async(method,params)=>({eth_chainId:'0x1237',eth_blockNumber:'0x11',
    eth_getTransactionByHash:proofs.get(params[0])?.tx,eth_getTransactionReceipt:proofs.get(params[0])?.receipt,
    eth_getBlockByNumber:{hash:'0x'+'1'.repeat(64),timestamp:'0x'+Math.floor(Date.now()/1000).toString(16)}}[method])
  const service=createIncentivesService({database:db,signer:admin.address,origin:ORIGIN,rpc})
  const handler=createIncentivesHandler({database:db,auth,service,basePath:'/app'})
  const server=createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,ORIGIN).pathname)){res.statusCode=404;res.end()}})
  server.listen(0,'127.0.0.1');await once(server,'listening')
  const root='http://127.0.0.1:'+server.address().port+'/app/api/incentives'
  async function call(path,body,session,headers={}){
    const response=await fetch(root+path,{method:body?'POST':'GET',headers:{origin:ORIGIN,'content-type':'application/json',...(session?{cookie:session.cookie,'x-saffron-csrf':session.csrf}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})})
    return {status:response.status,body:await response.json(),cookie:response.headers.get('set-cookie')?.split(';')[0]}
  }
  async function login(account){const challenge=(await call('/session/challenge',{wallet:account.address})).body
    const result=await call('/session/login',{wallet:account.address,nonce:challenge.nonce,signature:await account.signMessage({message:walletSessionMessage(challenge)})})
    assert.equal(result.status,200);return {cookie:result.cookie,csrf:result.body.session.csrf}}
  try{
    assert.equal((await call('/session/challenge',{wallet:user.address})).status,403)
    const a=await login(admin),secret='0x'+randomBytes(32).toString('hex'),hash='0x'+'2'.repeat(64)
    const quote=await store.quote(user,{signer:admin.address,fee:{recipient:admin.address.toLowerCase(),amountWei:'1000000000000000'},recoveryHash:proofHash(secret)})
    proofs.set(hash,{tx:{from:user.address,to:admin.address,value:'0x38d7ea4c68000',input:paymentData(quote)},
      receipt:{status:'0x1',transactionHash:hash,blockNumber:'0x10',blockHash:'0x'+'1'.repeat(64)}})
    const payment={quoteId:quote.id,paymentHash:hash,recoverySecret:secret}
    assert.equal((await call('/deployments',{...payment,recoverySecret:'0x'+'9'.repeat(64)})).status,403)
    const accepted=await call('/deployments',payment)
    const u={cookie:accepted.cookie,csrf:accepted.body.session?.csrf}
    assert.equal(accepted.status,201);assert.equal(accepted.body.deployment.state,'queued')
    const id=accepted.body.id
    assert.equal((await call('/deployments',payment,u)).body.id,id)
    assert.equal((await call('/deployments/'+id+'?wallet='+stranger.address)).status,404)
    assert.equal((await call('/admin/deployments',undefined,u)).status,403)
    assert.equal((await call('/admin/status',undefined,u)).status,403)
    const status=await call('/admin/status',undefined,a)
    assert.equal(status.body.pending,1);assert.equal(status.body.gasBalanceRaw,null)
    assert.equal((await call('/admin/deployments/'+id+'/fund',{planHash:quote.planHash,maximumRaw:quote.plan.premium},u)).status,403)
    assert.equal((await call('/deployments/'+id+'/cancel',{},u,{'x-saffron-csrf':'wrong'})).status,403)
    assert.equal((await call('/deployments/'+id+'/cancel',{},u,{origin:'https://foreign.example'})).status,403)
    const rows=await call('/admin/deployments',undefined,a)
    assert.equal(rows.body.deployments.length,1)
    assert.doesNotMatch(JSON.stringify(rows.body),/raw_tx|transaction_data|privateKey|signature/)
    assert.equal((await call('/deployments/'+id+'/cancel',{},u)).body.retired,true)
    for(let i=0;i<2;i++)await store.accept(user,await store.quote(user,{premium:'1000',signer:admin.address}))
    const foreign=(await store.accept(admin,await store.quote(admin,{premium:'1000'}))).id
    let cursor=null;const paged=[]
    do{
      const page=await call('/deployments?limit=1'+(cursor?'&cursor='+cursor:''),undefined,u)
      assert.equal(page.status,200);assert.equal(page.body.deployments.length,1)
      paged.push(page.body.deployments[0].id);cursor=page.body.nextCursor
    }while(cursor)
    assert.equal(paged.length,3);assert.equal(new Set(paged).size,3);assert.ok(paged.includes(id));assert.equal(paged.includes(foreign),false)
    const adminPage=await call('/admin/deployments?limit=2',undefined,a)
    assert.equal(adminPage.body.deployments.length,2);assert.ok(adminPage.body.nextCursor)
    assert.equal((await call('/admin/deployments?limit=2&cursor='+adminPage.body.nextCursor,undefined,a)).body.deployments.length,2)
    for(const query of ['limit=0','limit=101','limit=1.5','cursor=invalid'])assert.equal((await call('/deployments?'+query,undefined,u)).status,400)
    assert.equal((await call('/session/logout',{},u)).status,200)
    assert.equal((await call('/deployments',undefined,u)).status,401)
    assert.equal((await call('/unknown',undefined,a)).status,404)
  }finally{await new Promise(resolve=>server.close(resolve));await store.close()}
})

it('HTTP requests recover after an initial database outage without restarting the application',async()=>{
  const store=await incentivesFixture(),account=privateKeyToAccount(generatePrivateKey()),sockets=new Set()
  let available=false,database,server
  const proxy=net.createServer(client=>{
    if(!available){client.destroy();return}
    const target=net.createConnection(store.connection.host.startsWith('/')?{path:store.connection.host+'/.s.PGSQL.'+store.connection.port}:{host:store.connection.host,port:store.connection.port})
    for(const socket of [client,target]){sockets.add(socket);socket.on('close',()=>sockets.delete(socket))}
    client.on('error',()=>target.destroy());target.on('error',()=>client.destroy())
    client.pipe(target);target.pipe(client)
  })
  try{
    await store.seed(account.address)
    const accepted=await store.accept(account,await store.quote(account))
    proxy.listen(0,'127.0.0.1');await once(proxy,'listening')
    database=createIncentivesDatabase({connection:{...store.connection,host:'127.0.0.1',port:proxy.address().port,connectionTimeoutMillis:500},initializationRetryMs:20})
    await assert.rejects(database.ready)
    const auth=createWalletAuth({origin:ORIGIN,operators:[account.address]})
    const service=createIncentivesService({database,signer:account.address,rpc:async()=>{throw new Error('RPC not used')}})
    const handler=createIncentivesHandler({database,auth,service})
    server=createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,ORIGIN).pathname)){res.statusCode=404;res.end()}})
    server.listen(0,'127.0.0.1');await once(server,'listening')
    const root='http://127.0.0.1:'+server.address().port+'/api/incentives'
    const challenge=await fetch(root+'/session/challenge',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({wallet:account.address})}).then(response=>response.json())
    const login=await fetch(root+'/session/login',{method:'POST',headers:{origin:ORIGIN,'content-type':'application/json'},body:JSON.stringify({wallet:account.address,nonce:challenge.nonce,signature:await account.signMessage({message:walletSessionMessage(challenge)})})})
    assert.equal(login.status,200)
    const headers={cookie:login.headers.get('set-cookie').split(';')[0]}
    const unavailable=await fetch(root+'/deployments',{headers})
    assert.equal(unavailable.status,503)
    assert.deepEqual(await unavailable.json(),{error:'Incentives are unavailable. Your accepted deployment remains saved.'})
    available=true;await delay(25)
    const responses=await Promise.all(Array.from({length:12},()=>fetch(root+'/deployments',{headers})))
    for(const response of responses){assert.equal(response.status,200);assert.equal((await response.json()).deployments[0].id,accepted.id)}
    assert.equal((await database.auditBudget('cashcat-campaign')).budget.reservedRaw,'60000')
    await database.ready
  }finally{
    if(server)await new Promise(resolve=>server.close(resolve))
    if(database)await database.close()
    for(const socket of sockets)socket.destroy()
    if(proxy.listening)await new Promise(resolve=>proxy.close(resolve))
    await store.close()
  }
})
