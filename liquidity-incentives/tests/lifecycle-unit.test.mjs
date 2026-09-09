import { it } from 'node:test'
import assert from 'node:assert/strict'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { eligibility, FACTORY, adminSessionMessage, termsDigest } from '../shared/vault-lifecycle.mjs'
import { sqrtAtTick, amountsForLiquidity, resolveCapacities } from '../shared/liquidity-math.mjs'
import { createOperatorAuth } from '../server/operator-auth.mjs'

const now = Date.now()
const funded = { verified:true,canonical:true,chainId:4663,factory:FACTORY,checkedAt:now,headTimestamp:Math.floor(now/1000),
  initialized:true,isStarted:false,claimSupply:'0',variableCapacity:'1000000',variableSupply:'1000000',variableBalance:'1000000' }
it('requires exact bearer supply and covered raw premium, not merely a token transfer', () => {
  assert.equal(eligibility(funded,now).depositable,true)
  for(const update of [{variableSupply:'999999'}, {variableSupply:'1000001'}, {variableSupply:'0',variableBalance:'99999999'},
    {variableBalance:'999999'},{variableCapacity:'0'},{claimSupply:'1'},{isStarted:true}]) assert.equal(eligibility({...funded,...update},now).depositable,false)
})
it('fails closed on stale, malformed, noncanonical and wrong-identity observations', () => {
  for(const update of [{verified:false},{canonical:false},{factory:'0x'+'11'.repeat(20)},{chainId:1},{checkedAt:now-15001},
    {headTimestamp:Math.floor(now/1000)-61},{headTimestamp:undefined},{checkedAt:now+2000},{variableSupply:'bad'},{claimSupply:null}])
    assert.equal(eligibility({...funded,...update},now).depositable,false)
})
it('matches independently published TickMath boundary vectors', () => {
  assert.equal(sqrtAtTick(-887272),4295128739n)
  assert.equal(sqrtAtTick(0),1n<<96n)
  assert.equal(sqrtAtTick(887272),1461446703485210103287273052203988822378723970342n)
  assert.throws(()=>sqrtAtTick(887273));assert.throws(()=>sqrtAtTick(1.5))
})
it('sizes asymmetric-decimal tokens and one-sided ranges using integer units', () => {
  const args={cents:'10000',aprRaw:10n**18n,duration:31536000,price0:10n**18n,price1:10n**18n,variablePrice:10n**18n,
    decimals0:6,decimals1:18,variableDecimals:6,sqrtPrice:(1n<<96n)*1000000n,minTick:-887220,maxTick:887220}
  const sized=resolveCapacities(args)
  assert.equal(sized.premium,'100000000')
  const amounts=amountsForLiquidity(sized.liquidity,args.sqrtPrice,args.minTick,args.maxTick)
  assert.ok(amounts.amount0>=49999998n&&amounts.amount0<=50000002n)
  assert.equal(amountsForLiquidity(1000000n,sqrtAtTick(-60),0,60).amount1,0n)
  assert.equal(amountsForLiquidity(1000000n,sqrtAtTick(120),0,60).amount0,0n)
})
it('operator sessions are origin/action-bound, expiring, and require CSRF on writes', async () => {
  const account=privateKeyToAccount(generatePrivateKey()),stranger=privateKeyToAccount(generatePrivateKey())
  let clock=now
  const auth=createOperatorAuth({operators:[account.address],origin:'https://example.test',basePath:'/candidate',now:()=>clock})
  const req={headers:{origin:'https://example.test'}},headers={}
  assert.throws(()=>auth.challenge({headers:{origin:'https://attacker.test'}},account.address))
  assert.throws(()=>auth.challenge(req,stranger.address))
  const proof=auth.challenge(req,account.address)
  const body={wallet:account.address,nonce:proof.nonce,signature:await account.signMessage({message:adminSessionMessage(proof)})}
  const session=await auth.login(req,{setHeader:(key,value)=>headers[key]=value},body)
  assert.match(headers['Set-Cookie'],/HttpOnly; SameSite=Strict; Path=\/candidate; Max-Age=1800; Secure/)
  await assert.rejects(()=>auth.login(req,{setHeader(){}},body))
  const signed={headers:{...req.headers,cookie:headers['Set-Cookie'].split(';')[0]}}
  assert.equal(auth.session(signed).wallet,account.address.toLowerCase())
  assert.throws(()=>auth.session(signed,{mutation:true}))
  signed.headers['x-saffron-csrf']=session.csrf
  assert.equal(auth.session(signed,{mutation:true}).wallet,account.address.toLowerCase())
  clock+=1800001
  assert.throws(()=>auth.session(signed))
})
it('creation digest binds pool, premium, duration, size and requester but not UI status', () => {
  const row={requestId:'ABCDEFGHIJKL',chainId:4663,poolAddress:FACTORY,token0Address:FACTORY,token1Address:FACTORY,
    fixedCapacityAmount:'1000',durationSeconds:259200,targetApr:10,submitterAddress:FACTORY}
  assert.equal(termsDigest(row),termsDigest({...row,status:'created'}))
  for(const update of [{fixedCapacityAmount:'1001'},{durationSeconds:1},{targetApr:11},{poolAddress:'0x'+'11'.repeat(20)}])
    assert.notEqual(termsDigest(row),termsDigest({...row,...update}))
})
