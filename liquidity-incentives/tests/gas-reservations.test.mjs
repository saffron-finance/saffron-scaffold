import { it } from 'node:test'
import assert from 'node:assert/strict'
import { privateKeyToAccount,generatePrivateKey } from 'viem/accounts'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { creationGasCeiling } from '../server/gas-reservations.mjs'
import { createCreator } from '../worker/creator.mjs'
import { proofHash } from '../shared/payment.mjs'
import { ceilDiv } from '../shared/liquidity-math.mjs'

it('the recorded creation cost exceeds the $2 fee and consumes an explicit subsidy',()=>{
  const gasWei=1365461773476000n,price=2451894737489603357972n,fee=ceilDiv(2n*10n**36n,price)
  const subsidy=gasWei-fee
  assert.ok(subsidy>0n)
  assert.equal(ceilDiv(gasWei*price,10n**34n),335n)
  assert.equal(ceilDiv(subsidy*price,10n**34n),135n)
})

it('concurrent checkouts cannot overbook signer gas or subsidy and unpaid exposure survives a day boundary',{timeout:120000},async()=>{
  let time=Date.now();const chain=await evmFixture(),f=await incentivesFixture({now:()=>time}),db=f.database
  try{
    time=Date.now();await f.seed(chain.account.address,10n**30n+'');await chain.prepareIntake(db)
    const ceiling=creationGasCeiling(chain.config),config={...chain.config,maxDailyGasWei:(ceiling*2n-1n).toString()}
    const service=createIncentivesService({database:db,rpc:chain.rpc,config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const wallets=[chain.account.address,privateKeyToAccount(generatePrivateKey()).address]
    const results=await Promise.allSettled(wallets.map(wallet=>service.quote(wallet,'cashcat-3d','100',proofHash(chain.recoverySecret))))
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1)
    assert.equal((await db.query('SELECT count(*)::int n FROM saffron_incentives.deployment_quotes')).rows[0].n,1)
    assert.equal((await db.gasBook(chain.account.address)).exposureWei,ceiling.toString())
    time+=25*3600_000
    assert.equal((await db.gasBook(chain.account.address)).exposureWei,ceiling.toString())
    const noSubsidy=createIncentivesService({database:db,rpc:chain.rpc,config:{...chain.config,maxSubsidyWei:'1'},usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    assert.equal((await noSubsidy.readiness()).canQuote,false)
    const outage=createIncentivesService({database:db,rpc:async()=>{throw new Error('RPC unavailable')},config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    assert.ok((await outage.readiness()).reasons.includes('gas_unavailable'))
  }finally{await f.close();await chain.close()}
})

it('pending creation gas survives a day boundary; actual canonical cost replaces the ceiling only at completion',{timeout:120000},async()=>{
  let time=Date.now();const chain=await evmFixture(),f=await incentivesFixture({now:()=>time}),db=f.database
  try{
    time=Date.now();await f.seed(chain.account.address,10n**30n+'');await chain.prepareIntake(db)
    const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const accepted=await chain.accept(service),before=await db.gasBook(chain.account.address)
    let block=true
    const rpc=(method,params)=>{if(method==='eth_sendRawTransaction'&&block)throw new Error('Paused before broadcast');return chain.rpc(method,params)}
    const worker=createCreator({database:db,rpc,config:chain.config,account:chain.account})
    assert.equal((await worker.tick()).state,'waiting')
    const pending=await db.gasBook(chain.account.address)
    assert.ok(BigInt(pending.pendingTxWei)>0n);assert.equal(pending.exposureWei,before.exposureWei)
    time+=25*3600_000
    assert.equal((await db.gasBook(chain.account.address)).exposureWei,before.exposureWei)
    time=Date.now();block=false
    await db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW() WHERE intent_id=$1',[accepted.id])
    assert.equal((await worker.tick()).state,'created')
    const completed=await db.gasBook(chain.account.address),journal=await db.execution.transactions(accepted.id)
    const spent=journal.reduce((sum,t)=>sum+BigInt(t.receipt.gasUsed)*BigInt(t.receipt.effectiveGasPrice),0n)
    assert.equal(completed.exposureWei,'0');assert.equal(completed.spentWei,spent.toString());assert.equal(completed.pendingTxWei,'0')
    assert.ok(spent<BigInt(before.exposureWei));assert.equal((await db.gasBook(chain.account.address)).spentWei,completed.spentWei)
  }finally{await f.close();await chain.close()}
})
