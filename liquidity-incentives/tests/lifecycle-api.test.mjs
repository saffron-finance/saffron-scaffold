import { it } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createOperatorAuth } from '../server/operator-auth.mjs'
import { createLifecycleHandler } from '../server/lifecycle-api.mjs'
import { createVaultRequestHandler } from '../server/vault-requests.mjs'
import { adminSessionMessage } from '../shared/vault-lifecycle.mjs'
import { depositCents } from '../shared/vault-sizing.mjs'

it('keeps exact cents including trailing zeros and rejects sub-cent rounding',()=>{
  for(const [input,expected] of [['0.29','29'],['1000.01','100001'],['0001.2300','123']])assert.equal(depositCents(input),expected)
  for(const input of ['0','0.001','1.239','1e3','-1',null,100])assert.equal(depositCents(input),null)
})
it('native HTTP: nonce login, cookie polling, CSRF approval, no unauthenticated writes or redirects',async()=>{
  const account=privateKeyToAccount(generatePrivateKey()),origin='https://example.test',calls=[]
  const auth=createOperatorAuth({operators:[account.address],origin,basePath:'/app'})
  const database={list:async()=>[],lifecycle:{approveCreation:async args=>calls.push(['create',args]),approveFunding:async(...args)=>calls.push(['fund',args]),summary:async()=>({job:null})}}
  const service={decorate:async row=>row,status:async()=>({creatorConfigured:true,creatorOnline:false}),context:async()=>{throw Object.assign(new Error('Awaiting admin funding'),{status:409})}}
  const handler=createLifecycleHandler({database,auth,service,signer:account.address,basePath:'/app'})
  const legacy=createVaultRequestHandler({database,basePath:'/app'})
  const server=createServer(async(req,res)=>{const path=new URL(req.url,'http://localhost').pathname;if(!await handler(req,res,path)&&!await legacy(req,res,path)){res.writeHead(404);res.end()}})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  const root='http://127.0.0.1:'+server.address().port+'/app/vault-requests'
  let cookie='',csrf=''
  const get=path=>fetch(root+path,{headers:{cookie}})
  const post=(path,body,headers={})=>fetch(root+path,{method:'POST',headers:{origin,cookie,'x-saffron-csrf':csrf,'content-type':'application/json',...headers},body:JSON.stringify(body)})
  try {
    assert.equal((await get('/admin/requests')).status,401)
    assert.equal((await post('/admin/ABC123DEF456/create',{})).status,401)
    assert.equal((await post('/operator/challenge',{wallet:account.address},{origin:'https://wrong.test'})).status,401)
    const proof=await(await post('/operator/challenge',{wallet:account.address})).json()
    const login=await post('/operator/login',{wallet:account.address,nonce:proof.nonce,signature:await account.signMessage({message:adminSessionMessage(proof)})})
    assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=(await login.json()).csrf
    assert.equal((await get('/admin/requests')).status,200)
    assert.equal((await get('/operator/session')).status,200)
    assert.equal((await post('/admin/ABC123DEF456/create',{}, {'x-saffron-csrf':''})).status,401)
    assert.equal(calls.length,0)
    assert.equal((await post('/admin/ABC123DEF456/create',{termsDigest:'reviewed'})).status,200)
    assert.equal(calls[0][0],'create');assert.equal(calls[0][1].operator,account.address.toLowerCase())
    assert.equal((await get('/ABC123DEF456/deposit-context?wallet='+account.address)).status,409)
    for(const action of ['create','fixed','variable']) {
      const response=await get('/handoff?action='+action)
      assert.equal(response.status,410);assert.equal(response.headers.get('location'),null)
    }
  } finally {await new Promise(resolve=>server.close(resolve))}
})
