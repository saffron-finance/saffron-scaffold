import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {encodeFunctionData,parseAbi,toHex} from 'viem'
import {randomBytes} from 'node:crypto'
import {evmFixture} from './evm-fixture.mjs'
import {verifyRefund,BULKSENDER,bulkAbi} from '../server/refund-proof.mjs'
import {incentivesFixture,ORIGIN} from './incentives-fixture.mjs'
import {createIncentivesService} from '../server/incentives-service.mjs'
import {createCreator} from '../worker/creator.mjs'
import {randomUUID} from 'node:crypto'
const code=JSON.parse(readFileSync(new URL('./fixtures/bulksender-qualified.json',import.meta.url)))
test('pinned bulk sender delivers atomically on a disposable chain and verifies without traces',async()=>{
  const chain=await evmFixture()
  try{
    await chain.raw('anvil_setCode',[BULKSENDER.address,code.proxyCode]);await chain.raw('anvil_setCode',[BULKSENDER.implementation,code.implementationCode])
    await chain.raw('anvil_setStorageAt',[BULKSENDER.address,BULKSENDER.slot,'0x'+BULKSENDER.implementation.slice(2).padStart(64,'0')])
    const setupAbi=parseAbi(['function initialize(address owner)','function txFee() view returns(uint256)'])
    await chain.send(BULKSENDER.address,encodeFunctionData({abi:setupAbi,functionName:'initialize',args:[chain.account.address]}))
    const fee=await chain.client.readContract({address:BULKSENDER.address,abi:setupAbi,functionName:'txFee'})
    const recipients=['0x4444444444444444444444444444444444444444','0x5555555555555555555555555555555555555555']
    const amount=123456789n,data=()=>encodeFunctionData({abi:bulkAbi,functionName:'bulksendEther',args:[[BULKSENDER.address,...recipients],[amount*2n,amount,amount],'0x'+randomBytes(32).toString('hex')]})
    const receipt=await chain.send(BULKSENDER.address,data(),amount*2n+fee)
    const rpc=(method,params)=>{assert(!/debug|trace|send|sign/i.test(method));return chain.raw(method,params)}
    const proof=await verifyRefund(receipt.transactionHash,chain.account.address,rpc)
    assert.equal(proof.state,'verified');assert.equal(proof.payouts.length,2)
    for(const recipient of recipients)assert.equal(await chain.client.getBalance({address:recipient}),amount)
    await chain.raw('anvil_setCode',[recipients[1],'0x60006000fd'])
    const failed=await chain.wallet.sendTransaction({to:BULKSENDER.address,data:data(),value:amount*2n+fee,gas:1000000n})
    await chain.raw('evm_mine',[])
    assert.equal((await verifyRefund(failed,chain.account.address,rpc)).state,'failed')
    assert.equal(await chain.client.getBalance({address:recipients[0]}),amount,'the first recipient rolls back when the second rejects')
  }finally{await chain.close()}
})

test('a created but unprovided premium closes after a full external refund and never reopens Deposit',async()=>{
  const chain=await evmFixture(),store=await incentivesFixture(),db=store.database
  try{
    await store.seed(chain.account.address,10n**30n+'');await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db,{mode:'automatic'})
    const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const accepted=await chain.accept(service),worker=createCreator({database:db,rpc:chain.rpc,account:chain.account,config:chain.config})
    assert.equal((await worker.tick()).state,'created')
    const job=await db.getIntent(accepted.id),payment=(await db.query('SELECT * FROM saffron_incentives.payment_obligations WHERE quote_id=$1',[job.quote_id])).rows[0]
    const resolution={operator:chain.account.address,revision:payment.revision,requestKey:randomUUID(),reason:'Premium funding cannot be provided'}
    await service.refunds.approve(payment.hash,resolution,{category:'funding_unavailable',fundingStopped:true})
    // The fee recipient is an externally controlled test account on this chain.
    const source=chain.feeRecipient
    await chain.raw('anvil_setBalance',[source,toHex(10n**18n)])
    await chain.raw('anvil_impersonateAccount',[source])
    const batch=await service.refunds.prepare({source,payments:[payment.hash],requestKey:randomUUID()},chain.account.address)
    const hash=await chain.raw('eth_sendTransaction',[{from:source,to:chain.account.address,value:toHex(BigInt(payment.amount_wei)),gas:'0x5208'}]);await chain.raw('evm_mine',[])
    await service.refunds.submit(batch.id,[hash],chain.account.address);await service.refunds.poll()
    assert.equal((await db.paymentObligation(payment.hash)).state,'refunded')
    assert.equal((await service.detail(job.id,chain.account.address)).state,'refunded')
    // Even an erroneous later external funding call cannot reopen this request.
    await chain.fund(job)
    const row=await service.detail(job.id,chain.account.address)
    assert.equal(row.depositable,false);assert.equal(row.state,'refunded')
    assert.equal((await worker.tick()).state,'idle')
    assert.equal((await service.refunds.detail(batch.id)).outstandingWei,'0')
  }finally{await store.close();await chain.close()}
})
