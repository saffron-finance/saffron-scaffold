import assert from 'node:assert/strict'
import { it } from 'node:test'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { createWalletAuth } from '../server/wallet-auth.mjs'
import { cents,integer,walletSessionMessage,normalizeBudget,digest } from '../shared/incentives.mjs'

it('wallet sessions bind origin, nonce, wallet and CSRF; operators are a separate permission',async()=>{
  const user=privateKeyToAccount(generatePrivateKey()),operator=privateKeyToAccount(generatePrivateKey())
  const origin='http://127.0.0.1:13218',request={headers:{origin}},headers={}
  let now=Date.now()
  const auth=createWalletAuth({origin,operators:[operator.address],now:()=>now})
  const proof=auth.challenge(request,user.address),signature=await user.signMessage({message:walletSessionMessage(proof)})
  const session=await auth.login(request,{setHeader:(key,value)=>{headers[key]=value}},{wallet:user.address,nonce:proof.nonce,signature})
  assert.equal(session.operator,false);assert.match(headers['Set-Cookie'],/HttpOnly; SameSite=Strict/)
  const authenticated={headers:{...request.headers,cookie:headers['Set-Cookie'].split(';')[0],'x-saffron-csrf':session.csrf}}
  assert.equal(auth.session(authenticated,{mutation:true}).wallet,user.address.toLowerCase())
  assert.throws(()=>auth.session(authenticated,{operator:true}),e=>e.status===403)
  assert.throws(()=>auth.session({headers:{...authenticated.headers,origin:'https://elsewhere.example'}},{mutation:true}),e=>e.status===403)
  assert.throws(()=>auth.session({headers:{...authenticated.headers,'x-saffron-csrf':''}},{mutation:true}),e=>e.status===403)
  await assert.rejects(auth.login(request,{setHeader(){}},{wallet:user.address,nonce:proof.nonce,signature}),e=>e.status===401)
  now+=31*60_000;assert.throws(()=>auth.session(authenticated),e=>e.status===401)
})
it('amount validation preserves exact cents and raw token integers',()=>{
  assert.equal(cents('100.01'),'10001');assert.equal(cents('0.10'),'10')
  for(const value of ['1.001','1e3','-1','0','NaN']) assert.throws(()=>cents(value))
  assert.equal(integer('1000000000000000000000000000001'),'1000000000000000000000000000001')
  assert.throws(()=>integer('1e18'));assert.throws(()=>integer((1n<<256n).toString()))
  assert.equal(digest({a:1,b:{c:2,d:3}}),digest({b:{d:3,c:2},a:1}))
  assert.throws(()=>normalizeBudget({limitRaw:'-1'}))
})
