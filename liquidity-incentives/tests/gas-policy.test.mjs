import { it } from 'node:test'
import assert from 'node:assert/strict'
import { legacyGasPrice } from '../worker/gas-policy.mjs'

it('base-fee-only rollup quotes retain margin for a rising next-block fee',()=>{
  const price=legacyGasPrice({suggested:126908000n,baseFee:126908000n,maximum:2000000000n})
  assert.equal(price,253816000n)
  assert.ok(price>147420000n,'covers the higher base fee observed during the live test')
})

it('stale quotes below the current base are raised to twice the current base',()=>{
  assert.equal(legacyGasPrice({suggested:100n,baseFee:150n,maximum:1000n}),300n)
})

it('priority margin survives alongside base-fee headroom; non-EIP-1559 quotes remain unchanged',()=>{
  assert.equal(legacyGasPrice({suggested:1100n,baseFee:100n,maximum:2000n}),1200n)
  assert.equal(legacyGasPrice({suggested:1100n,maximum:2000n}),1100n)
})

it('headroom cannot silently exceed or be clipped to the operator fee ceiling',()=>{
  assert.throws(()=>legacyGasPrice({suggested:150n,baseFee:100n,maximum:200n}),/budget/)
  assert.equal(legacyGasPrice({suggested:150n,baseFee:100n,maximum:250n}),250n)
})

it('zero, negative and malformed fee-policy inputs fail closed',()=>{
  for(const change of [{suggested:0n},{suggested:-1n},{baseFee:-1n},{maximum:0n},{maximum:-1n},{suggested:'bad'}]){
    assert.throws(()=>legacyGasPrice({suggested:100n,baseFee:50n,maximum:1000n,...change}))
  }
})
