import { it } from 'node:test'
import assert from 'node:assert/strict'
import { campaignTerms,campaignPremiumCents } from '../shared/campaign.mjs'
import { proofHash,paymentData } from '../shared/payment.mjs'
import { verifyPayment } from '../server/payment-proof.mjs'

it('campaign calculator derives any third field, preserves cents, and uses simple 365-day APR',()=>{
  const terms=campaignTerms({days:3,budgetUsd:'10000',capacityUsd:'1000000'})
  assert.ok(Math.abs(Number(terms.aprPercent)-121.66666666666667)<1e-10)
  assert.equal(campaignPremiumCents(terms,'50000000'),'500000')
  assert.equal(campaignTerms({days:3,budgetUsd:'10000',aprPercent:'100'}).capacityCents,'121666666')
  assert.equal(campaignTerms({days:3,capacityUsd:'1000000',aprPercent:'100'}).budgetCents,'821918')
  assert.equal(campaignPremiumCents(terms,'1'),'1','a fractional funding cent rounds up')
  for(const input of [{days:3,budgetUsd:'1'}, {days:3,budgetUsd:'1',capacityUsd:'1',aprPercent:'1'},
    {days:0,budgetUsd:'1',capacityUsd:'1'},{days:3,budgetUsd:'-1',capacityUsd:'1'},
    {days:3,budgetUsd:'1.001',capacityUsd:'1'},{days:3,budgetUsd:'1',aprPercent:'0'}])assert.throws(()=>campaignTerms(input))
})

/** A deterministic canonical RPC is enough to isolate each receipt predicate;
 * EVM/browser suites also submit real signed native ETH transactions. */
function paymentFixture(){
  const secret='0x'+'4'.repeat(64),hash='0x'+'5'.repeat(64),blockHash='0x'+'6'.repeat(64)
  const quote={id:'request-one',planHash:'0x'+'7'.repeat(64),wallet:'0x'+'1'.repeat(40),recoveryHash:proofHash(secret),
    paymentDeadline:'2026-09-10T12:01:00.000Z',fee:{recipient:'0x'+'2'.repeat(40),amountWei:'1000'}}
  const data={eth_chainId:'0x1237',eth_blockNumber:'0x11',eth_getTransactionByHash:{hash,blockHash,blockNumber:'0x10',from:quote.wallet,to:quote.fee.recipient,value:'0x3e8',input:paymentData(quote)},
    eth_getTransactionReceipt:{status:'0x1',transactionHash:hash,blockNumber:'0x10',blockHash},
    eth_getBlockByNumber:{hash:blockHash,timestamp:'0x'+Math.floor(Date.parse('2026-09-10T12:00:00Z')/1000).toString(16)}}
  return {quote,hash,secret,data,rpc:async method=>data[method]}
}
it('ETH payment binds sender, recipient, exact amount, quote, recovery capability, chain and canonical confirmations',async()=>{
  let f=paymentFixture();assert.equal((await verifyPayment(f.quote,f.hash,f.secret,f.rpc)).verified,true)
  await assert.rejects(verifyPayment(f.quote,f.hash,'0x'+'8'.repeat(64),f.rpc),e=>e.status===403)
  const changes=[['eth_chainId','0x1'],['eth_blockNumber','0x10'],['eth_getTransactionReceipt',null],
    ['eth_getTransactionReceipt',{...f.data.eth_getTransactionReceipt,status:'0x0'}],
    ['eth_getBlockByNumber',{...f.data.eth_getBlockByNumber,hash:'0x'+'9'.repeat(64)}],
    ...Object.entries({hash:'0x'+'9'.repeat(64),blockHash:'0x'+'8'.repeat(64),blockNumber:'0x9',from:f.quote.fee.recipient,to:f.quote.wallet,value:'0x3e7',input:'0x'}).map(([k,v])=>['eth_getTransactionByHash',{...f.data.eth_getTransactionByHash,[k]:v}])]
  for(const [method,value]of changes){f=paymentFixture();f.data[method]=value;await assert.rejects(verifyPayment(f.quote,f.hash,f.secret,f.rpc))}
  f=paymentFixture();f.quote.paymentDeadline='2026-09-10T11:59:00Z'
  assert.equal((await verifyPayment(f.quote,f.hash,f.secret,f.rpc)).late,true,'late payments retain evidence for resolution, not creation')
})

it('payment policy rejects self-transfers, overpayments, invalid deadlines/timestamps and weakened finality',async()=>{
  for(const alter of [
    f=>f.quote.fee.recipient=f.quote.wallet,
    f=>f.quote.fee.amountWei='0',
    f=>f.quote.paymentDeadline='invalid',
    f=>f.data.eth_getTransactionByHash.value='0x3e9',
    f=>f.data.eth_getBlockByNumber.timestamp='0x'+'f'.repeat(64),
    f=>f.data.eth_getTransactionReceipt.transactionHash='0x'+'9'.repeat(64),
  ]){const f=paymentFixture();alter(f);await assert.rejects(verifyPayment(f.quote,f.hash,f.secret,f.rpc))}
  for(const confirmations of [0,1,1.5,NaN]){const f=paymentFixture();await assert.rejects(verifyPayment(f.quote,f.hash,f.secret,f.rpc,{confirmations}))}
})
