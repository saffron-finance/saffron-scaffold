import { it } from 'node:test'
import assert from 'node:assert/strict'
import { eligibility, FACTORY } from '../shared/vault-lifecycle.mjs'
import { sqrtAtTick, amountsForLiquidity, resolveCapacities } from '../shared/liquidity-math.mjs'

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
