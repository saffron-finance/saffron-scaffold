import {it} from 'node:test'
import assert from 'node:assert/strict'
import {creationFeeRecipient,quoteCreationFee} from '../server/creation-fee.mjs'
const recipient='0x'+'1'.repeat(40),time=100_000
it('fee configuration rejects missing, malformed and zero recipients',()=>{
  for(const value of [undefined,'','0x123','0x'+'0'.repeat(40)])assert.throws(()=>creationFeeRecipient(value),/recipient/)
  assert.equal(creationFeeRecipient(' '+recipient+' '),recipient)
})
it('native fee quotes freeze the original recipient and exact upward-rounded wei',()=>{
  const first=quoteCreationFee(recipient,{priceRaw:'3000000000000000000000',checkedAt:time},time)
  const next=quoteCreationFee('0x'+'2'.repeat(40),{priceRaw:'2000000000000000000000',checkedAt:time+1},time+1)
  assert.equal(first.amountWei,'666666666666667');assert.equal(first.recipient,recipient)
  assert.equal(next.amountWei,'1000000000000000');assert.notEqual(next.recipient,first.recipient)
  for(const eth of [{priceRaw:'0',checkedAt:time},{priceRaw:'invalid',checkedAt:time},{priceRaw:'1',checkedAt:time-60001},{priceRaw:'1',checkedAt:time+5001}])
    assert.throws(()=>quoteCreationFee(recipient,eth,time),/fresh ETH/)
})
