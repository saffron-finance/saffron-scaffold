import { it } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData,encodeAbiParameters,keccak256 } from 'viem'
import { evmFixture,CASHCAT } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createCreator } from '../worker/creator.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { abi,eligibility } from '../shared/vault-lifecycle.mjs'
import { amountsForLiquidity } from '../shared/liquidity-math.mjs'

async function fixture(){
  const chain=await evmFixture(),store=await incentivesFixture(),db=store.database
  await store.seed(chain.account.address,10n**30n+'')
  await db.execution.heartbeat(chain.account.address)
  const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,origin:ORIGIN})
  async function accept(){return store.accept(chain.account,await service.quote(chain.account.address,'cashcat-3d','100'))}
  const options={database:db,rpc:chain.rpc,account:chain.account,config:chain.config}
  return {chain,store,db,service,accept,options,close:async()=>{await store.close();await chain.close()}}
}

it('signed intent creates once, separately funds, gates fixed entry, and retains cumulative premium after claim', {timeout:120000},async()=>{
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
    await service.fund(id,chain.account.address,row.planHash,row.plan.premium)
    assert.equal((await worker.tick()).state,'funded')
    row=await service.detail(id,chain.account.address)
    assert.equal(row.depositable,true)
    const funded=chain.broadcasts
    assert.equal((await worker.tick()).state,'idle');assert.equal(chain.broadcasts,funded)
    const json=JSON.stringify(row)
    assert.equal(json.includes('raw_tx'),false);assert.equal(json.includes('transaction_data'),false)
    // Pre-start withdrawal reverses readiness without releasing the obligation.
    await chain.send(vault,encodeFunctionData({abi,functionName:'withdraw',args:[1n,'0x']}))
    row=await service.detail(id,chain.account.address);assert.equal(row.depositable,false)
    await service.fund(id,chain.account.address,row.planHash,row.plan.premium)
    assert.equal((await worker.tick()).state,'funded')
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
    const rpc=(method,params)=>method==='eth_getTransactionReceipt'&&hide?Promise.resolve(null):chain.rpc(method,params)
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

it('pause prevents new signing; retirement reconciles and recovers unused funding before releasing budget', {timeout:120000},async()=>{
  const f=await fixture(),{db,chain,service}=f
  try{
    const id=(await f.accept()).id,worker=createCreator(f.options)
    await db.query('UPDATE saffron_incentives.budget_pools SET paused=TRUE')
    assert.equal((await worker.tick()).state,'waiting');assert.equal(chain.broadcasts,0)
    await db.query('UPDATE saffron_incentives.budget_pools SET paused=FALSE')
    await db.query('UPDATE saffron_incentives.vault_jobs SET next_attempt_at=NOW()')
    assert.equal((await worker.tick()).state,'created')
    let row=await service.detail(id,chain.account.address)
    await service.fund(id,chain.account.address,row.planHash,row.plan.premium)
    assert.equal((await worker.tick()).state,'funded')
    const checkpoint=await chain.raw('evm_snapshot')
    await db.cancelDeployment(id,chain.account.address)
    assert.notEqual((await db.catalog(true)).budgets[0].allocatedRaw,'0')
    await db.execution.approveOperation(id,chain.account.address,row.planHash,'retire')
    assert.equal((await worker.tick()).state,'retired')
    row=await service.detail(id,chain.account.address);assert.equal(row.state,'retired')
    assert.equal(row.observation.variableSupply,'0')
    const budget=(await db.catalog(true)).budgets[0]
    assert.equal(budget.allocatedRaw,'0');assert.equal(budget.reservedRaw,'0')
    assert.equal((await db.auditBudget(budget.id)).valid,true)
    // A reorganized recovery must close admission and restore the obligation
    // before the old signed withdrawal can be reconciled again.
    await chain.raw('evm_revert',[checkpoint])
    assert.equal(await service.auditReleases(budget.id),false)
    assert.equal((await db.catalog(true)).budgets[0].reconciliationRequired,true)
    await service.reconcileBudget(budget.id,chain.account.address)
    assert.equal((await db.catalog(true)).budgets[0].reservedRaw,row.plan.premium)
    assert.equal((await worker.tick()).state,'retired')
    assert.equal((await db.auditBudget(budget.id)).valid,true)
    assert.equal((await db.catalog(true)).budgets[0].reservedRaw,'0')
  }finally{await f.close()}
})
