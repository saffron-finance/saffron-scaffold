import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { privateKeyToAccount,generatePrivateKey } from 'viem/accounts'
import { toHex } from 'viem'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { verifyRefund } from '../server/refund-proof.mjs'
import { paymentData,proofHash } from '../shared/payment.mjs'

it('external native refunds settle partial amounts, reject reused/wrong evidence and reopen after a reorg',{timeout:120000},async()=>{
  const chain=await evmFixture(),f=await incentivesFixture(),db=f.database,treasury=privateKeyToAccount(generatePrivateKey())
  const service=createIncentivesService({database:db,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN,refundSenders:[treasury.address]})
  const resolution=async hash=>({operator:chain.account.address.toLowerCase(),revision:(await db.paymentObligation(hash)).revision,requestKey:randomUUID(),reason:'Return unused creation fee after canonical review.'})
  async function refund(to,value,data='0x'){
    const hash=await chain.wallet.sendTransaction({account:treasury,to,value,data})
    await chain.client.waitForTransactionReceipt({hash});await chain.raw('evm_mine');return hash
  }
  try{
    await f.seed(chain.account.address,(10n**30n).toString());await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
    await chain.raw('anvil_setBalance',[treasury.address,toHex(10n**18n)])
    const q=await service.quote(chain.account.address,'cashcat-3d','100',proofHash(chain.recoverySecret))
    const fee=await chain.send(q.fee.recipient,paymentData(q),BigInt(q.fee.amountWei)),hash=fee.transactionHash
    const accepted=await service.acceptPayment(q.id,hash,chain.recoverySecret)
    await db.markRefundDue(hash,await resolution(hash))
    const early=await refund(chain.account.address,1n)
    await assert.rejects(service.recordExternalRefund(hash,early,await resolution(hash)),/retire/)
    await db.cancelDeployment(accepted.id,chain.account.address)
    const row=await db.paymentObligation(hash)
    for(const invalid of [
      await refund(treasury.address,100n),
      (await chain.send(chain.account.address,'0x',100n)).transactionHash,
      await refund(chain.account.address,100n,'0x1234'),
    ])await assert.rejects(verifyRefund(row,invalid,chain.rpc,{senders:[treasury.address]}),e=>e.status===400)
    const tooMuch=await refund(chain.account.address,BigInt(q.fee.amountWei)+1n)
    await assert.rejects(service.recordExternalRefund(hash,tooMuch,await resolution(hash)),/exceeds/)
    const partial=await service.recordExternalRefund(hash,early,await resolution(hash))
    assert.equal(partial.state,'refund_due');assert.equal(partial.refundedWei,'1')
    const snapshot=await chain.raw('evm_snapshot')
    const last=await refund(chain.account.address,BigInt(q.fee.amountWei)-1n),request=await resolution(hash)
    const settled=await service.recordExternalRefund(hash,last,request)
    assert.equal(settled.state,'refunded');assert.equal(settled.outstandingWei,'0')
    assert.deepEqual(await service.recordExternalRefund(hash,last,request),settled)
    await assert.rejects(service.recordExternalRefund(hash,last,await resolution(hash)),/resolution changed/)
    await assert.rejects(verifyRefund(row,last,async(method,args)=>method==='eth_chainId'?'0x1':chain.rpc(method,args),{senders:[treasury.address]}),/chain/)
    await chain.raw('evm_revert',[snapshot]);await service.reconcileRefunds()
    assert.equal((await db.paymentObligation(hash)).state,'reconciliation_required')
    assert.equal((await db.catalog(true)).budgets[0].reconciliationRequired,true)
    const publicStatus=(await db.listPayments({wallet:chain.account.address.toLowerCase(),all:true})).payments[0]
    assert.equal(publicStatus.refunded_wei,'1')
    assert.equal(publicStatus.refunds.find(r=>r.hash===last).state,'orphaned')
    const orphaned=(await db.query('SELECT * FROM saffron_incentives.refund_transfers WHERE hash=$1',[last])).rows[0]
    const cancelled=await chain.wallet.sendTransaction({account:treasury,to:treasury.address,value:0n,nonce:Number(orphaned.evidence.nonce)})
    await chain.client.waitForTransactionReceipt({hash:cancelled});await chain.raw('evm_mine')
    const reconciled=await service.replaceExternalRefund(hash,last,cancelled,await resolution(hash))
    assert.equal(reconciled.state,'refund_due');assert.equal(reconciled.refundedWei,'1')
    const replacement=await refund(chain.account.address,BigInt(q.fee.amountWei)-1n)
    assert.equal((await service.recordExternalRefund(hash,replacement,await resolution(hash))).state,'refunded')
    await service.reconcileRefunds()
    assert.equal((await db.paymentObligation(hash)).state,'refunded')
    assert.equal(chain.broadcasts,0,'refund observer and HTTP service never broadcast')
  }finally{await f.close();await chain.close()}
})

it('one refund hash cannot settle two payment obligations even when both belong to the same payer',{timeout:120000},async()=>{
  const chain=await evmFixture(),f=await incentivesFixture(),db=f.database,treasury=privateKeyToAccount(generatePrivateKey())
  const service=createIncentivesService({database:db,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN,refundSenders:[treasury.address]})
  const resolution=async hash=>({operator:chain.account.address.toLowerCase(),revision:(await db.paymentObligation(hash)).revision,requestKey:randomUUID(),reason:'Return each independently received duplicate fee.'})
  try{
    await f.seed(chain.account.address,(10n**30n).toString());await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
    await chain.raw('anvil_setBalance',[treasury.address,toHex(10n**18n)])
    const q=await service.quote(chain.account.address,'cashcat-3d','100',proofHash(chain.recoverySecret))
    const original=await chain.send(q.fee.recipient,paymentData(q),BigInt(q.fee.amountWei))
    await service.acceptPayment(q.id,original.transactionHash,chain.recoverySecret)
    const duplicates=[]
    for(let i=0;i<2;i++){
      const receipt=await chain.send(q.fee.recipient,paymentData(q),BigInt(q.fee.amountWei))
      await assert.rejects(service.acceptPayment(q.id,receipt.transactionHash,chain.recoverySecret),e=>e.status===409)
      await db.markRefundDue(receipt.transactionHash,await resolution(receipt.transactionHash));duplicates.push(receipt.transactionHash)
    }
    const hash=await chain.wallet.sendTransaction({account:treasury,to:chain.account.address,value:BigInt(q.fee.amountWei)})
    await chain.client.waitForTransactionReceipt({hash})
    assert.equal((await service.recordExternalRefund(duplicates[0],hash,await resolution(duplicates[0]))).state,'confirming')
    await chain.raw('evm_mine');await service.reconcileRefunds()
    assert.equal((await db.paymentObligation(duplicates[0])).state,'refunded')
    await assert.rejects(service.recordExternalRefund(duplicates[1],hash,await resolution(duplicates[1])),/already been allocated/)
    assert.equal((await db.paymentObligation(original.transactionHash)).execution_allowed,true)
    assert.equal((await db.catalog(true)).budgets[0].reservedRaw,q.plan.premium)
  }finally{await f.close();await chain.close()}
})
