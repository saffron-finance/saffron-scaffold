import { it } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData,encodeAbiParameters,keccak256 } from 'viem'
import { evmFixture,CASHCAT } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createCreator } from '../worker/creator.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { abi,eligibility } from '../shared/vault-lifecycle.mjs'
import { amountsForLiquidity } from '../shared/liquidity-math.mjs'

async function fixture(databaseOptions={}){
  const chain=await evmFixture(),store=await incentivesFixture(databaseOptions),db=store.database
  await store.seed(chain.account.address,10n**30n+'')
  await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
  const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
  async function accept(){return chain.accept(service)}
  const options={database:db,rpc:chain.rpc,account:chain.account,config:chain.config}
  return {chain,store,db,service,accept,options,close:async()=>{await store.close();await chain.close()}}
}

it('progress follows three separate receipts and external funding, and a lower canonical height revokes readiness',{timeout:120000},async()=>{
  const f=await fixture(),{db,chain,service}=f
  try{
    const {id}=await f.accept();let permitted=1
    const rpc=async(method,params)=>{
      if(method==='eth_sendRawTransaction'&&(await db.execution.transactions(id)).length>permitted)throw new Error('Pause before the next factory stage')
      return chain.rpc(method,params)
    }
    const worker=createCreator({...f.options,rpc})
    for(let count=1;count<=3;count++){
      permitted=count;await db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW() WHERE intent_id=$1',[id])
      await worker.tick()
      const row=await service.detail(id,chain.account.address)
      assert.equal(row.progress.stages.filter(s=>s.state==='complete').length,count)
      assert.equal(row.depositable,false)
      assert.equal(new Set(row.progress.stages.filter(s=>s.state==='complete').map(s=>s.hash)).size,count)
    }
    const job=await db.getIntent(id),snapshot=await chain.raw('evm_snapshot'),premium=BigInt(job.plan.premium)
    await chain.send(CASHCAT,encodeFunctionData({abi,functionName:'approve',args:[job.plan.vault,premium]}))
    await chain.send(job.plan.vault,encodeFunctionData({abi,functionName:'deposit',args:[premium-1n,1n,'0x']}))
    assert.equal((await service.detail(id,chain.account.address)).progress.stages[3].state,'active')
    await chain.send(job.plan.vault,encodeFunctionData({abi,functionName:'deposit',args:[1n,1n,'0x']}))
    const funded=await service.detail(id,chain.account.address)
    assert.equal(funded.depositable,true);assert.equal(funded.progress.stages[3].state,'complete')
    await chain.raw('evm_revert',[snapshot])
    const restored=await service.detail(id,chain.account.address)
    assert.equal(restored.depositable,false);assert.equal(restored.state,'awaiting_funding')
    assert.equal(restored.observation.variableSupply,'0')
    const unavailable=createIncentivesService({database:db,rpc:async()=>{throw new Error('Read outage')},config:chain.config,signer:chain.account.address})
    const checking=await unavailable.describe(await db.getIntent(id))
    assert.equal(checking.progress.verificationAvailable,false);assert.equal(checking.depositable,false)
    assert.doesNotMatch(JSON.stringify(checking.progress),/raw_tx|recoverySecret|transaction_data/)
  }finally{await f.close()}
})

it('ETH-paid request creates once, externally funds, gates fixed entry, and retains cumulative premium after claim', {timeout:120000},async()=>{
  const f=await fixture(),{db,chain,service}=f
  try{
    const accepted=await f.accept(),id=accepted.id
    const worker=createCreator(f.options)
    chain.beforeBroadcast=async raw=>assert.equal((await db.query('SELECT hash FROM saffron_incentives.chain_operations WHERE hash=$1',[keccak256(raw)])).rowCount,1)
    chain.loseBroadcast=true
    assert.equal((await worker.tick()).state,'created')
    assert.equal(chain.broadcasts,3)
    assert.equal((await worker.tick()).state,'idle')
    let row=await service.detail(id,chain.account.address)
    assert.equal(row.state,'awaiting_funding');assert.equal(row.depositable,false)
    const premium=BigInt(row.plan.premium),vault=row.plan.vault
    // A direct token transfer does not create variable bearer supply.
    await chain.send(CASHCAT,encodeFunctionData({abi:chain.tokenAbi,functionName:'transfer',args:[vault,premium]}))
    assert.equal((await service.detail(id,chain.account.address)).depositable,false)
    await chain.send(CASHCAT,encodeFunctionData({abi,functionName:'approve',args:[vault,premium]}))
    await chain.send(vault,encodeFunctionData({abi,functionName:'deposit',args:[premium-1n,1n,'0x']}))
    row=await service.detail(id,chain.account.address)
    assert.equal(row.depositable,false,'one raw unit short cannot enter')
    await chain.fund(row)
    assert.equal((await worker.tick()).state,'idle')
    row=await service.detail(id,chain.account.address)
    assert.equal(row.depositable,true)
    const funded=chain.broadcasts
    assert.equal((await worker.tick()).state,'idle');assert.equal(chain.broadcasts,funded)
    const json=JSON.stringify(row)
    assert.equal(json.includes('raw_tx'),false);assert.equal(json.includes('transaction_data'),false)
    // Pre-start withdrawal reverses readiness without releasing the obligation.
    await chain.send(vault,encodeFunctionData({abi,functionName:'withdraw',args:[1n,'0x']}))
    row=await service.detail(id,chain.account.address);assert.equal(row.depositable,false)
    await chain.fund(row)
    assert.equal((await worker.tick()).state,'idle')
    const ctx=await service.context(id,chain.account.address),s=ctx.snapshot
    assert.equal(eligibility(s).depositable,true)
    const amounts=amountsForLiquidity(s.liquidity,s.sqrtPrice,s.minTick,s.maxTick)
    for(const [i,token] of [s.token0,s.token1].entries())await chain.send(token.address,encodeFunctionData({abi,functionName:'approve',args:[s.adapter,[amounts.amount0,amounts.amount1][i]*101n/100n+1n]}))
    const data=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],[amounts.amount0*995n/1000n,amounts.amount1*995n/1000n,BigInt(Math.floor(Date.now()/1000)+300)])
    await chain.send(vault,encodeFunctionData({abi,functionName:'deposit',args:[0n,0n,data]}))
    row=await service.detail(id,chain.account.address)
    assert.equal(row.state,'claimable');assert.equal(row.canClaim,true);assert.equal(row.depositable,false)
    await chain.send(vault,encodeFunctionData({abi,functionName:'claim'}))
    row=await service.detail(id,chain.account.address)
    assert.equal(row.state,'active');assert.equal(row.canClaim,false)
    const budget=(await db.catalog(true)).budgets[0]
    assert.equal(budget.allocatedRaw,premium.toString());assert.equal(budget.reservedRaw,'0')
    assert.equal((await db.auditBudget(budget.id)).valid,true)
  }finally{await f.close()}
})

it('unknown receipt survives restart; retry delay permits unrelated work without replacing a saved nonce', {timeout:120000},async()=>{
  const f=await fixture(),{db,chain}=f
  try{
    const id=(await f.accept()).id
    let hide=true
    const rpc=async(method,params)=>method==='eth_getTransactionReceipt'&&hide&&(await db.query('SELECT 1 FROM saffron_incentives.chain_operations WHERE hash=$1',[params[0]])).rowCount?Promise.resolve(null):chain.rpc(method,params)
    assert.equal((await createCreator({...f.options,rpc}).tick()).state,'waiting')
    const tx=await db.execution.lastTransaction(id,'create-adapter')
    assert.equal(chain.broadcasts,1)
    assert.equal((await createCreator({...f.options,rpc}).tick()).state,'idle','backoff avoids immediate reclaims')
    await db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW() WHERE intent_id=$1',[id])
    assert.equal((await createCreator({...f.options,rpc}).tick()).state,'waiting')
    assert.equal(chain.broadcasts,1);assert.equal((await db.execution.lastTransaction(id,'create-adapter')).hash,tx.hash)
    const second=(await f.accept()).id
    hide=false
    assert.equal((await createCreator({...f.options,rpc}).tick()).state,'created')
    assert.equal((await db.getIntent(second)).state,'created')
    await db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW() WHERE intent_id=$1',[id])
    assert.equal((await createCreator({...f.options,rpc}).tick()).state,'created')
    assert.equal(chain.broadcasts,6)
  }finally{await f.close()}
})

it('pause prevents new signatures while manual recovery preserves the recorded commitment',{timeout:120000},async()=>{
  const f=await fixture(),{db,chain,service}=f
  try{
    const {id}=await f.accept(),worker=createCreator(f.options)
    await db.query('UPDATE saffron_incentives.budget_pools SET paused=TRUE')
    assert.equal((await worker.tick()).state,'waiting');assert.equal(chain.broadcasts,0)
    await db.query('UPDATE saffron_incentives.budget_pools SET paused=FALSE')
    await db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW()')
    assert.equal((await worker.tick()).state,'created')
    const row=await service.detail(id,chain.account.address)
    await chain.fund(row);await service.refresh(id)
    const checkpoint=await chain.raw('evm_snapshot')
    await chain.send(row.plan.vault,encodeFunctionData({abi,functionName:'withdraw',args:[1n,'0x']}))
    await service.refresh(id)
    assert.equal((await db.catalog(true)).budgets[0].reservedRaw,row.plan.premium)
    await chain.raw('evm_revert',[checkpoint]);await service.refresh(id)
    assert.equal((await db.catalog(true)).budgets[0].allocatedRaw,row.plan.premium)
    assert.equal((await db.auditBudget('cashcat-campaign')).valid,true)
    assert.equal((await worker.tick()).state,'idle')
  }finally{await f.close()}
})

it('a distinct external treasury funds a USD campaign without worker custody and consumes matching capacity',{timeout:120000},async()=>{
  const f=await fixture({checkoutPolicy:{maxQuoteBps:5000,maxHeldBps:10000}}),{chain,db,service}=f
  try{
    await db.saveCampaign({requestFeeWei:'1000000000000000',id:'usd-campaign',name:'USD campaign',pairId:'cashcat-eth',days:3,budgetUsd:'10000',capacityUsd:'1000000',active:true},chain.account.address)
    const {generatePrivateKey,privateKeyToAccount}=await import('viem/accounts')
    const {createWalletClient,http,toHex}=await import('viem')
    const treasury=privateKeyToAccount(generatePrivateKey()),wallet=createWalletClient({account:treasury,chain:chain.client.chain,transport:http(chain.url)})
    await chain.raw('anvil_setBalance',[treasury.address,toHex(10n**19n)])
    await chain.send(CASHCAT,encodeFunctionData({abi:chain.tokenAbi,functionName:'mint',args:[treasury.address,10n**26n]}))
    const {id}=await chain.accept(service,'usd-campaign','500000')
    assert.equal((await createCreator(f.options).tick()).state,'created')
    const row=await service.detail(id,chain.account.address),amount=BigInt(row.plan.premium)
    for(const [to,data]of [[CASHCAT,encodeFunctionData({abi,functionName:'approve',args:[row.plan.vault,amount]})],
      [row.plan.vault,encodeFunctionData({abi,functionName:'deposit',args:[amount,1n,'0x']})]]){
      const hash=await wallet.sendTransaction({to,data});await chain.client.waitForTransactionReceipt({hash});await chain.raw('evm_mine')
    }
    const ready=await service.detail(id,chain.account.address),a=(await db.catalog(true)).budgets.find(b=>b.id==='usd-campaign').accounting
    assert.equal(ready.depositable,true);assert.equal(ready.observation.fundingBearerBalance,'0','the creator holds no treasury bearer rights')
    assert.equal(a.fundedBudgetCents,'500000');assert.equal(a.availableBudgetCents,'500000')
    assert.equal(a.fundedCapacityCents,'50000000');assert.equal(a.availableCapacityCents,'50000000');assert.equal(a.fixedDepositedCents,'0')
    assert.equal(chain.broadcasts,3,'only adapter, vault and initialization use worker signing')
    await assert.rejects(db.execution.approveOperation(id,chain.account.address,row.planHash,'retire'),/Unsupported/)
    assert.equal((await createCreator(f.options).tick()).state,'idle','the creator never withdraws external premium')
    assert.equal((await db.catalog(true)).budgets.find(b=>b.id==='usd-campaign').accounting.fundedBudgetCents,'500000')
  }finally{await f.close()}
})

it('an orphaned creation payment cannot authorize a new worker transaction or release its reservation',{timeout:120000},async()=>{
  const f=await fixture()
  try{
    const before=await f.chain.raw('evm_snapshot'),{id}=await f.accept()
    await f.chain.raw('evm_revert',[before])
    assert.equal((await createCreator(f.options).tick()).state,'waiting')
    assert.equal(f.chain.broadcasts,0)
    assert.notEqual((await f.db.catalog(true)).budgets[0].reservedRaw,'0')
    assert.equal((await f.db.execution.transactions(id)).length,0)
  }finally{await f.close()}
})

it('campaign fees stay fixed across price changes, revisions and actual wallet payments',{timeout:120000},async()=>{
  const f=await fixture(),{db,chain,service}=f
  try{
    const {proofHash,paymentData}=await import('../shared/payment.mjs')
    const program=(await db.catalog(true)).programs[0],secret=chain.recoverySecret
    const first=await service.quote(chain.account.address,program.id,'100',proofHash(secret))
    assert.equal(first.fee.amountWei,program.requestFeeWei)
    assert.deepEqual(Object.keys(first.fee).sort(),['amountWei','asset','recipient'])
    // LP sizing still uses live prices. Changing every valuation cannot reprice
    // the campaign's ETH charge or add a separate ETH/USD fee oracle dependency.
    const changedPrices=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,
      usdQuote:async address=>{const q=await chain.usdQuote(address);return {...q,priceRaw:(BigInt(q.priceRaw)*2n).toString()}},
      signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    assert.equal((await changedPrices.quote(chain.account.address,program.id,'100',proofHash(secret))).fee.amountWei,first.fee.amountWei)
    await db.saveProgram({...program,requestFeeWei:'1234567890123456'},chain.account.address)
    const next=await service.quote(chain.account.address,program.id,'100',proofHash(secret))
    assert.equal(next.fee.amountWei,'1234567890123456')
    assert.deepEqual((await db.quote(first.id)).fee,first.fee)
    // An already-issued fee remains payable after configuration changes. Verify
    // real chain value and idempotent acceptance, not a mocked browser result.
    const receipt=await chain.send(first.fee.recipient,paymentData(first),BigInt(first.fee.amountWei))
    const tx=await chain.client.getTransaction({hash:receipt.transactionHash})
    assert.equal(tx.value,BigInt(first.fee.amountWei))
    const accepted=await service.acceptPayment(first.id,receipt.transactionHash,secret)
    assert.equal((await service.acceptPayment(first.id,receipt.transactionHash,secret)).id,accepted.id)
    assert.equal((await db.list({wallet:chain.account.address})).jobs.length,1)
    const other=await db.saveProgram({...program,id:'second-fee',revision:0,requestFeeWei:'7'},chain.account.address)
    assert.equal((await service.quote(chain.account.address,other.id,'100',proofHash(secret))).fee.amountWei,'7')
    // Existing catalogs receive no guessed fee on upgrade; other configured
    // campaigns can continue, but the legacy program cannot issue a quote.
    await db.query("UPDATE saffron_incentives.programs SET body=body-'requestFeeWei' WHERE id=$1",[other.id])
    await assert.rejects(service.quote(chain.account.address,other.id,'100',proofHash(secret)),/fixed ETH request fee/)
  }finally{await f.close()}
})
