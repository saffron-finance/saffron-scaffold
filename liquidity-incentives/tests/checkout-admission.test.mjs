import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { privateKeyToAccount,generatePrivateKey } from 'viem/accounts'
import { incentivesFixture,pair,ORIGIN } from './incentives-fixture.mjs'
import { createCheckoutAdmission } from '../server/checkout-admission.mjs'
const account=()=>privateKeyToAccount(generatePrivateKey())

it('public unpaid quotes have individual and aggregate campaign caps across arbitrary wallets',async()=>{
  const f=await incentivesFixture(),db=f.database,a=account()
  try{
    await db.savePair(pair,a.address)
    await db.saveCampaign({id:'bounded',name:'Bounded',pairId:pair.id,days:3,budgetUsd:'1000',capacityUsd:'100000',active:true},a.address)
    await assert.rejects(f.quote(a,{programId:'bounded',principalCents:'10000000'}),e=>e.status===409)
    for(let i=0;i<2;i++)await f.quote(account(),{programId:'bounded',principalCents:'1000000'})
    await assert.rejects(f.quote(account(),{programId:'bounded',principalCents:'1000000'}),e=>e.status===429)
    assert.equal((await db.catalog(true)).budgets[0].accounting.heldCapacityCents,'2000000')
    assert.equal((await db.catalog(true)).budgets[0].accounting.availableCapacityCents,'8000000')
  }finally{await f.close()}
})

it('browser checkout identity survives restart and cannot bypass issuance limits with forwarded headers',async()=>{
  const f=await incentivesFixture(),options={database:f.database,origin:ORIGIN},admission=createCheckoutAdmission(options)
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{}},res={setHeader:(name,value)=>{res.cookie=value}}
  try{
    await assert.rejects(admission.require(req),e=>e.status===403)
    await admission.issue(req,res);req.headers.cookie=res.cookie.split(';')[0]
    assert.match(res.cookie,/HttpOnly; SameSite=Strict/)
    const identity=await admission.require(req)
    assert.equal(await createCheckoutAdmission(options).require(req),identity)
    for(let i=1;i<10;i++)await admission.issue({...req,headers:{'x-forwarded-for':'192.0.2.'+i}},res)
    await assert.rejects(admission.issue({...req,headers:{}},res),e=>e.status===429)
    await admission.issue(req,res)
    assert.equal((await f.database.query('SELECT count(*)::int n FROM saffron_incentives.checkout_clients')).rows[0].n,10)
  }finally{await f.close()}
})

it('checkout retries return one immutable quote and each browser holds at most one unpaid slot',async()=>{
  const f=await incentivesFixture(),a=account(),admission=createCheckoutAdmission({database:f.database,origin:ORIGIN})
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{}},res={setHeader:(name,value)=>{req.headers.cookie=value.split(';')[0]}}
  try{
    await f.seed(a.address);await admission.issue(req,res)
    const options={clientHash:await admission.require(req),requestKey:randomUUID(),recoveryHash:'0x'+'4'.repeat(64),premium:'1000'}
    const results=await Promise.all([f.quote(a,options),f.quote(a,options)])
    assert.equal(results[0].id,results[1].id)
    await assert.rejects(f.quote(a,{...options,principalCents:'20000'}),e=>e.status===409)
    await assert.rejects(f.quote(account(),{...options,requestKey:randomUUID()}),e=>e.status===429)
    assert.equal((await f.database.query('SELECT count(*)::int n FROM saffron_incentives.deployment_quotes')).rows[0].n,1)
  }finally{await f.close()}
})
