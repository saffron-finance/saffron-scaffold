import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createWalletAuth } from '../server/wallet-auth.mjs'
import { createIncentivesHandler } from '../server/incentives-api.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { walletSessionMessage,deploymentTypedData } from '../shared/incentives.mjs'

it('HTTP wallet authorization, atomic replay, privacy, CSRF and separate operator permissions',async()=>{
  const store=await incentivesFixture(),db=store.database
  const user=privateKeyToAccount(generatePrivateKey()),admin=privateKeyToAccount(generatePrivateKey()),stranger=privateKeyToAccount(generatePrivateKey())
  await store.seed(admin.address)
  const auth=createWalletAuth({origin:ORIGIN,basePath:'/app',operators:[admin.address]})
  const service=createIncentivesService({database:db,signer:admin.address,rpc:async()=>{throw new Error('Not used')}})
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
    const u=await login(user),a=await login(admin),other=await login(stranger)
    const quote=await store.quote(user,{signer:admin.address}),signature=await user.signTypedData(deploymentTypedData(quote))
    const accepted=await call('/deployments',{quoteId:quote.id,signature},u)
    assert.equal(accepted.status,201);assert.equal(accepted.body.deployment.state,'queued')
    const id=accepted.body.id
    assert.equal((await call('/deployments',{quoteId:quote.id,signature},u)).body.id,id)
    assert.equal((await call('/deployments/'+id,undefined,other)).status,404)
    assert.equal((await call('/admin/deployments',undefined,u)).status,403)
    assert.equal((await call('/admin/deployments/'+id+'/fund',{planHash:quote.planHash,maximumRaw:quote.plan.premium},u)).status,403)
    assert.equal((await call('/deployments/'+id+'/cancel',{},u,{'x-saffron-csrf':'wrong'})).status,403)
    assert.equal((await call('/deployments/'+id+'/cancel',{},u,{origin:'https://foreign.example'})).status,403)
    const rows=await call('/admin/deployments',undefined,a)
    assert.equal(rows.body.deployments.length,1)
    assert.doesNotMatch(JSON.stringify(rows.body),/raw_tx|transaction_data|privateKey|signature/)
    assert.equal((await call('/deployments/'+id+'/cancel',{},u)).body.retired,true)
    assert.equal((await call('/session/logout',{},u)).status,200)
    assert.equal((await call('/deployments',undefined,u)).status,401)
    assert.equal((await call('/unknown',undefined,a)).status,404)
  }finally{await new Promise(resolve=>server.close(resolve));await store.close()}
})
