import {it} from 'node:test'
import assert from 'node:assert/strict'
import {creationFeeRecipient,quoteCreationFee} from '../server/creation-fee.mjs'
import {requestFeeFromEth,UINT256_MAX} from '../shared/incentives.mjs'
const recipient='0x'+'1'.repeat(40)
it('fee configuration rejects missing, malformed and zero recipients',()=>{
  for(const value of [undefined,'','0x123','0x'+'0'.repeat(40)])assert.throws(()=>creationFeeRecipient(value),/recipient/)
  assert.equal(creationFeeRecipient(' '+recipient+' '),recipient)
})
it('campaign fees copy exact wei with no oracle, dollar peg or rounding',()=>{
  const first=quoteCreationFee(recipient,'1234567890123456789')
  const next=quoteCreationFee('0x'+'2'.repeat(40),'1')
  assert.deepEqual(first,{asset:'ETH',recipient,amountWei:'1234567890123456789'})
  assert.equal(next.amountWei,'1');assert.notEqual(next.recipient,first.recipient)
  assert.equal(quoteCreationFee(recipient,UINT256_MAX.toString()).amountWei,UINT256_MAX.toString())
  for(const amount of [undefined,'','0','-1','01','1.5',1,'1e18',(UINT256_MAX+1n).toString(),{priceRaw:'2000000000000000000000',checkedAt:Date.now()}])
    assert.throws(()=>quoteCreationFee(recipient,amount),/fixed ETH request fee/)
})
it('operator ETH input retains every wei and rejects excess precision rather than rounding',()=>{
  assert.equal(requestFeeFromEth('0.000000000000000001'),'1')
  assert.equal(requestFeeFromEth('1.234567890123456789'),'1234567890123456789')
  assert.equal(requestFeeFromEth('0.001'),'1000000000000000')
  for(const input of ['0','0.0000000000000000001','-1','1e-3','NaN','01',' 1 ',undefined])assert.throws(()=>requestFeeFromEth(input))
})
