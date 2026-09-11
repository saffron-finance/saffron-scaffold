import { it } from 'node:test'
import assert from 'node:assert/strict'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { createPaymentWatcher } from '../worker/payments.mjs'
import { runOneRequest } from '../worker/one-shot.mjs'
import { simulateFactory } from '../worker/fork-simulate.mjs'
import { proofHash,paymentData } from '../shared/payment.mjs'
import { privateFilesFixture } from './private-files-fixture.mjs'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'

/** A real local ETH payment is discovered from blocks, not an API callback or a
 * mocked verified flag. The actual database and creator then finish the vault. */
async function fixture(options={}){
  const chain=await evmFixture(),store=await incentivesFixture(options),db=store.database
  await store.seed(chain.account.address,10n**30n+'');await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
  const service=createIncentivesService({database:db,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
  return {chain,store,db,service,
    quote:()=>service.quote(chain.account.address,'cashcat-3d','100',proofHash(chain.recoverySecret)),
    close:async()=>{await store.close();await chain.close()}}
}

it('keyless watcher finds a lost callback, rejects incorrect fees, and feeds exactly one real local vault',{timeout:120000},async()=>{
  const f=await fixture(),files=await privateFilesFixture('saffron-watch-flow-'),{directory}=files
  try{
    const q=await f.quote(),startBlock=BigInt(await f.chain.raw('eth_blockNumber')).toString(),data=paymentData(q),amount=BigInt(q.fee.amountWei)
    const receiverBefore=BigInt(await f.chain.raw('eth_getBalance',[q.fee.recipient,'latest']))
    await f.chain.send(q.fee.recipient,data,amount-1n)
    await f.chain.send(q.fee.recipient,data,amount+1n)
    await f.chain.send(f.chain.account.address,data,amount)
    await f.chain.send(q.fee.recipient,'0x'+'7'.repeat(64),amount)
    const receipt=await f.chain.send(q.fee.recipient,data,amount)
    const duplicate=await f.chain.send(q.fee.recipient,data,amount)
    const receiverAfter=BigInt(await f.chain.raw('eth_getBalance',[q.fee.recipient,'latest']))
    assert.equal(receiverAfter-receiverBefore,amount*5n)
    const watcher=createPaymentWatcher({database:f.db,rpc:f.chain.rpc,startBlock,maxBlocks:2})
    let accepted=0,rejected=0
    for(let i=0;i<20;i++){const result=await watcher.tick();accepted+=result.accepted;rejected+=result.rejected;if(result.scanned===0)break}
    assert.equal(accepted,1);assert.equal(rejected,1)
    assert.deepEqual((await f.db.listPayments()).payments.map(row=>row.kind).sort(),['duplicate-fee','overpayment','underpayment'])
    const row=(await f.db.query('SELECT id FROM saffron_incentives.deployment_intents WHERE quote_id=$1',[q.id])).rows[0]
    const proof=(await f.db.query('SELECT * FROM saffron_incentives.payment_proofs WHERE quote_id=$1',[q.id])).rows[0]
    assert.equal(proof.hash,receipt.transactionHash);assert.equal(proof.state,'fulfilled')
    assert.equal((await f.db.query('SELECT kind FROM saffron_incentives.payment_exceptions WHERE hash=$1',[duplicate.transactionHash])).rows[0].kind,'duplicate-fee')
    const before=await f.db.getIntent(row.id)
    const recovered=await f.service.recoverPayment(q.id,f.chain.recoverySecret)
    assert.equal(recovered.deployment.id,row.id);assert.equal(recovered.paymentHash,receipt.transactionHash)
    await assert.rejects(f.service.recoverPayment(q.id,'0x'+'0'.repeat(64)),/recovery record/)
    await f.db.query('UPDATE saffron_incentives.payment_scan_cursors SET block_number=NULL,block_hash=NULL')
    const replay=createPaymentWatcher({database:f.db,rpc:f.chain.rpc,startBlock,maxBlocks:50})
    assert.equal((await replay.tick()).accepted,0)
    assert.equal((await f.db.query('SELECT count(*)::int n FROM saffron_incentives.deployment_intents')).rows[0].n,1)
    const simulation=await simulateFactory({upstream:f.chain.raw,config:f.chain.config,job:before})
    const result=await runOneRequest({database:f.db,rpc:f.chain.rpc,account:f.chain.account,config:{...f.chain.config,maxDailyGasWei:'1000000000000000000'},
      requestId:row.id,simulation,directory,pollMs:5})
    assert.equal(result.observation.initialized,true);assert.equal(f.chain.broadcasts,3)
    assert.equal(result.observation.variableSupply,'0');assert.equal(result.observation.claimSupply,'0')
  }finally{await f.close();await files.close()}
})

it('watcher survives RPC interruption, serializes replicas, pins start, and resets its orphaned cursor',{timeout:120000},async()=>{
  const f=await fixture()
  try{
    const q=await f.quote(),startBlock=BigInt(await f.chain.raw('eth_blockNumber')).toString(),snapshot=await f.chain.raw('evm_snapshot')
    await f.chain.send(q.fee.recipient,paymentData(q),BigInt(q.fee.amountWei))
    const options={database:f.db,rpc:f.chain.rpc,startBlock,maxBlocks:50}
    await assert.rejects(createPaymentWatcher({...options,rpc:async(method,params)=>method==='eth_chainId'?'0x1':f.chain.rpc(method,params)}).tick(),/Wrong payment chain/)
    let fail=true
    const interrupted=createPaymentWatcher({...options,rpc:async(method,params)=>{
      if(method==='eth_getTransactionReceipt'&&fail){fail=false;throw new Error('Injected read outage')}
      return f.chain.rpc(method,params)
    }})
    await assert.rejects(interrupted.tick(),/Injected read outage/)
    assert.equal((await f.db.query('SELECT count(*)::int n FROM saffron_incentives.deployment_intents')).rows[0].n,0)
    const client=await f.db.pool.connect()
    try{
      await client.query("SELECT pg_advisory_lock(hashtextextended('saffron-payment-scan:native-eth-v1',0))")
      assert.equal((await interrupted.tick()).state,'locked')
    }finally{await client.query("SELECT pg_advisory_unlock(hashtextextended('saffron-payment-scan:native-eth-v1',0))");client.release()}
    assert.equal((await interrupted.tick()).accepted,1)
    await assert.rejects(createPaymentWatcher({...options,startBlock:'0'}).tick(),/pinned start/)
    await f.chain.raw('evm_revert',[snapshot])
    assert.equal((await interrupted.tick()).state,'reorg-reset')
    assert.equal((await f.db.query("SELECT block_number FROM saffron_incentives.payment_scan_cursors WHERE id='native-eth-v1'")).rows[0].block_number,null)
    assert.equal(f.chain.broadcasts,0)
  }finally{await f.close()}
})

it('late mined payments are retained for attention and cannot enter the creation queue',{timeout:120000},async()=>{
  const f=await fixture()
  try{
    const q=await f.quote(),startBlock=BigInt(await f.chain.raw('eth_blockNumber')).toString()
    await f.chain.raw('evm_increaseTime',[180])
    const receipt=await f.chain.send(q.fee.recipient,paymentData(q),BigInt(q.fee.amountWei))
    const result=await createPaymentWatcher({database:f.db,rpc:f.chain.rpc,startBlock,maxBlocks:50}).tick()
    assert.equal(result.attention,1);assert.equal(result.accepted,0)
    assert.equal((await f.db.query('SELECT state FROM saffron_incentives.payment_proofs WHERE hash=$1',[receipt.transactionHash])).rows[0].state,'needs_attention')
    assert.equal((await f.db.query('SELECT count(*)::int n FROM saffron_incentives.vault_jobs')).rows[0].n,0)
  }finally{await f.close()}
})

it('explicit late-payment admission preserves the deadline and reaches the real creator once',{timeout:120000},async()=>{
  const f=await fixture({quoteMs:1000}),files=await privateFilesFixture('saffron-late-resolution-')
  try{
    const q=await f.quote(),startBlock=BigInt(q.plan.sizingBlock).toString()
    await delay(2100)
    const receipt=await f.chain.send(q.fee.recipient,paymentData(q),BigInt(q.fee.amountWei))
    await createPaymentWatcher({database:f.db,rpc:f.chain.rpc,startBlock}).tick()
    const obligation=await f.db.paymentObligation(receipt.transactionHash)
    assert.equal(obligation.kind,'late-fee')
    const resolution={operator:f.chain.account.address.toLowerCase(),revision:obligation.revision,requestKey:randomUUID(),reason:'Honor the reserved original request after reviewing the late fee.'}
    const result=await f.service.admitOriginalPayment(receipt.transactionHash,resolution)
    assert.deepEqual(await f.service.admitOriginalPayment(receipt.transactionHash,resolution),result)
    assert.equal((await f.db.quote(q.id)).paymentDeadline,q.paymentDeadline)
    const simulation=await simulateFactory({upstream:f.chain.raw,config:f.chain.config,job:await f.db.getIntent(result.id)})
    await runOneRequest({database:f.db,rpc:f.chain.rpc,account:f.chain.account,config:{...f.chain.config,maxDailyGasWei:'1000000000000000000'},requestId:result.id,simulation,directory:files.directory,pollMs:5})
    assert.equal(f.chain.broadcasts,3)
    assert.equal((await f.db.query('SELECT count(*)::int n FROM saffron_incentives.payment_resolution_audit')).rows[0].n,1)
  }finally{await f.close();await files.close()}
})

it('canonical watcher settlement releases unpaid holds and reopens them after a reorg',{timeout:120000},async()=>{
  const f=await fixture()
  try{
    const q=await f.quote(),startBlock=BigInt(q.plan.sizingBlock).toString(),snapshot=await f.chain.raw('evm_snapshot')
    await f.db.withdrawQuote(q.id,f.chain.recoverySecret)
    await f.chain.raw('evm_increaseTime',[180]);await f.chain.raw('anvil_mine',['0x3'])
    const watcher=createPaymentWatcher({database:f.db,rpc:f.chain.rpc,startBlock})
    await watcher.tick()
    assert.equal((await f.db.query('SELECT hold_state FROM saffron_incentives.deployment_quotes WHERE id=$1',[q.id])).rows[0].hold_state,'released')
    await f.chain.raw('evm_revert',[snapshot])
    assert.equal((await watcher.tick()).state,'reorg-reset')
    assert.equal((await f.db.query('SELECT hold_state FROM saffron_incentives.deployment_quotes WHERE id=$1',[q.id])).rows[0].hold_state,'closing')
    assert.equal((await f.db.catalog(true)).budgets[0].reconciliationRequired,true)
  }finally{await f.close()}
})

it('a timely payment discovered after its deadline keeps its original reserved admission',{timeout:120000},async()=>{
  const f=await fixture()
  try{
    const q=await f.quote(),startBlock=BigInt(q.plan.sizingBlock).toString()
    await f.db.withdrawQuote(q.id,f.chain.recoverySecret)
    await f.chain.send(q.fee.recipient,paymentData(q),BigInt(q.fee.amountWei))
    await f.chain.raw('evm_increaseTime',[180]);await f.chain.raw('anvil_mine',['0x2'])
    const watcher=createPaymentWatcher({database:f.db,rpc:f.chain.rpc,startBlock})
    assert.equal((await watcher.tick()).accepted,1)
    assert.equal((await watcher.tick()).accepted,0)
    assert.equal((await f.db.query('SELECT hold_state FROM saffron_incentives.deployment_quotes WHERE id=$1',[q.id])).rows[0].hold_state,'accepted')
  }finally{await f.close()}
})
