import { it } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData, encodeAbiParameters, keccak256 } from 'viem'
import { evmFixture, CASHCAT } from './evm-fixture.mjs'
import { postgresFixture } from './postgres-fixture.mjs'
import { seedRequest } from './lifecycle-fixture.mjs'
import { createCreator } from '../worker/creator.mjs'
import { createLifecycleService } from '../server/lifecycle-service.mjs'
import { termsDigest, eligibility, abi } from '../shared/vault-lifecycle.mjs'
import { amountsForLiquidity } from '../shared/liquidity-math.mjs'

it('real protocol bytecode: duplicate queue → lost broadcast → creation → partial/full/withdrawn funding → fixed deposit/start', {timeout:120000}, async () => {
  const chain=await evmFixture(), store=await postgresFixture(),db=store.database
  try {
    const row=await seedRequest(db,chain.account.address)
    const approval={requestId:row.requestId,expectedDigest:termsDigest(row),operator:chain.account.address,signer:chain.account.address}
    await Promise.all(Array.from({length:6},()=>db.lifecycle.approveCreation(approval)))
    assert.equal((await db.pool.query('SELECT * FROM liqifi.vault_creation_jobs')).rowCount,1)
    const worker=createCreator({database:db,rpc:chain.rpc,account:chain.account,config:chain.config,usdQuote:chain.usdQuote})
    const service=createLifecycleService({database:db,rpc:chain.rpc,signer:chain.account.address})
    chain.beforeBroadcast=async raw=>assert.equal((await db.pool.query('SELECT hash FROM liqifi.vault_creation_transactions WHERE hash=$1',[keccak256(raw)])).rowCount,1,'signed bytes durable before broadcast')
    chain.loseBroadcast=true
    assert.equal((await worker.tick()).state,'created')
    assert.equal(chain.broadcasts,3)
    assert.equal((await worker.tick()).state,'idle')
    await db.lifecycle.approveCreation(approval)
    assert.equal(chain.broadcasts,3,'duplicate approval never recreates')
    let current=(await db.list({requestId:row.requestId}))[0]
    let decorated=await service.decorate(current)
    assert.equal(decorated.lifecycle.depositable,false)
    assert.equal(decorated.lifecycle.state,'awaiting_funding')
    let job=await db.lifecycle.job(row.requestId)
    const cap=BigInt(job.plan.premium),vault=job.plan.vault
    assert.ok(cap>0n)
    await chain.send(CASHCAT,encodeFunctionData({abi,functionName:'approve',args:[vault,cap]}))
    await chain.send(vault,encodeFunctionData({abi,functionName:'deposit',args:[cap-1n,1n,'0x']}))
    await service.refresh(row.requestId)
    assert.equal((await service.decorate(current)).lifecycle.depositable,false,'one base unit short stays closed')
    await db.lifecycle.approveFunding(row.requestId,chain.account.address,termsDigest(row),job.plan.premium)
    assert.equal((await worker.tick()).state,'funded')
    await service.refresh(row.requestId)
    decorated=await service.decorate(current)
    assert.equal(decorated.lifecycle.depositable,true)
    const afterFunding=chain.broadcasts
    assert.equal((await worker.tick()).state,'idle')
    assert.equal(chain.broadcasts,afterFunding)
    const payload=JSON.stringify(decorated)
    assert.equal(payload.includes('raw_tx'),false);assert.equal(payload.includes('transaction_data'),false)
    // Solidity's own rounding is the independent oracle for LP sizing.
    const s=decorated.lifecycle.observation
    const amounts=amountsForLiquidity(s.liquidity,s.sqrtPrice,s.minTick,s.maxTick)
    const actual=await chain.client.readContract({address:chain.manager,abi:chain.artifacts['Fixture.sol'].FixturePositionManager.abi,functionName:'amounts',args:[BigInt(s.liquidity),BigInt(s.sqrtPrice),s.minTick,s.maxTick]})
    assert.deepEqual([amounts.amount0,amounts.amount1],actual)
    // Admin can withdraw before start: the badge must be reversible.
    await chain.send(vault,encodeFunctionData({abi:chain.artifacts['UniV3Vault.sol'].UniV3Vault.abi,functionName:'withdraw',args:[1n,'0x']}))
    await service.refresh(row.requestId)
    assert.equal((await service.decorate(current)).lifecycle.depositable,false)
    await db.lifecycle.approveFunding(row.requestId,chain.account.address,termsDigest(row),job.plan.premium)
    assert.equal((await worker.tick()).state,'funded')
    const ctx=await service.context(row.requestId,chain.account.address)
    assert.equal(eligibility(ctx.snapshot).depositable,true)
    for(const [i,token] of [s.token0,s.token1].entries()) await chain.send(token.address,encodeFunctionData({abi,functionName:'approve',args:[s.adapter,[amounts.amount0,amounts.amount1][i]*101n/100n+1n]}))
    const data=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],[amounts.amount0*995n/1000n,amounts.amount1*995n/1000n,BigInt(Math.floor(Date.now()/1000)+300)])
    const deposited=await chain.send(vault,encodeFunctionData({abi,functionName:'deposit',args:[0n,0n,data]}))
    assert.equal(deposited.status,'success')
    assert.equal(await chain.client.readContract({address:vault,abi,functionName:'isStarted'}),true)
    await service.refresh(row.requestId)
    assert.equal((await service.decorate(current)).lifecycle.state,'occupied')
    await assert.rejects(()=>service.context(row.requestId,chain.account.address),/occupied/)
  } finally {await store.close();await chain.close()}
})

it('legacy sizing needs an explicit immutable snapshot and leaves receipt bytes untouched', async()=>{
  const store=await postgresFixture()
  try {
    const wallet='0x'+'12'.repeat(20),row=await seedRequest(store.database,wallet)
    await store.database.pool.query('UPDATE uniswap_v3_fiv.pending_vaults SET fixed_capacity_amount=999 WHERE request_id=$1',[row.requestId])
    const changed=(await store.database.list({requestId:row.requestId}))[0],before=await store.records()
    const approval={requestId:row.requestId,expectedDigest:termsDigest(changed),operator:wallet,signer:wallet}
    await assert.rejects(()=>store.database.lifecycle.approveCreation(approval),/sizing snapshot/)
    const job=await store.database.lifecycle.approveCreation({...approval,sizingReview:{cents:'1000',reason:'Reviewed original ten-dollar paid request'}})
    assert.equal(job.snapshot.fixedCapacityAmount,'1000')
    assert.equal(job.snapshot.sizingReview.originalCents,'999')
    assert.deepEqual(await store.records(),before)
  }finally{await store.close()}
})

it('restart with missing receipts retains the original signed nonce and creates no duplicate', {timeout:120000},async()=>{
  const chain=await evmFixture(),store=await postgresFixture(),db=store.database
  try {
    const row=await seedRequest(db,chain.account.address)
    await db.lifecycle.approveCreation({requestId:row.requestId,expectedDigest:termsDigest(row),operator:chain.account.address,signer:chain.account.address})
    let hideReceipts=true
    const rpc=(method,params)=>method==='eth_getTransactionReceipt'&&hideReceipts?Promise.resolve(null):chain.rpc(method,params)
    const options={database:db,rpc,account:chain.account,config:chain.config,usdQuote:chain.usdQuote}
    assert.equal((await createCreator(options).tick()).state,'waiting')
    assert.equal(chain.broadcasts,1)
    const tx=await db.lifecycle.lastTransaction(row.requestId,'create-adapter')
    assert.equal((await createCreator(options).tick()).state,'waiting')
    assert.equal(chain.broadcasts,1,'used nonce with unknown receipt cannot be replaced')
    assert.equal((await db.lifecycle.lastTransaction(row.requestId,'create-adapter')).hash,tx.hash)
    hideReceipts=false
    assert.equal((await createCreator(options).tick()).state,'created')
    assert.equal(chain.broadcasts,3)
    const service=createLifecycleService({database:db,signer:chain.account.address,rpc:async(method,params)=>{
      if(method==='eth_getBlockByNumber'&&params[0]!=='latest')throw new Error('Simulated reorg/unavailable block')
      return chain.rpc(method,params)
    }})
    await service.refresh(row.requestId)
    const current=(await db.list({requestId:row.requestId}))[0]
    assert.equal((await service.decorate(current)).lifecycle.state,'checking')
  }finally{await store.close();await chain.close()}
})
