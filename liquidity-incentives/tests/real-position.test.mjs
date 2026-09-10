import { it } from 'node:test'
import assert from 'node:assert/strict'
import { encodeFunctionData,encodeAbiParameters,createWalletClient,http,parseAbi,toHex } from 'viem'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { evmFixture } from './evm-fixture.mjs'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { createCreator } from '../worker/creator.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { abi } from '../shared/vault-lifecycle.mjs'
import { amountsForLiquidity } from '../shared/liquidity-math.mjs'
import { positionAction } from '../shared/position-actions.mjs'

it('real Uniswap factory and position manager: mint, claim conversion, maturity, fixed withdrawal, and variable fee settlement', {timeout:120000},async()=>{
  const chain=await evmFixture({realPositionManager:true}),store=await incentivesFixture(),db=store.database
  let offset=0
  try{
    await store.seed(chain.account.address,10n**30n+'',{pool:chain.pool})
    await db.execution.heartbeat(chain.account.address)
    const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,origin:ORIGIN,now:()=>Date.now()+offset})
    const id=(await store.accept(chain.account,await service.quote(chain.account.address,'cashcat-3d','100'))).id
    const worker=createCreator({database:db,rpc:chain.rpc,account:chain.account,config:chain.config})
    assert.equal((await worker.tick()).state,'created')
    let row=await service.detail(id,chain.account.address)
    await service.fund(id,chain.account.address,row.planHash,row.plan.premium)
    assert.equal((await worker.tick()).state,'funded')
    let s=(await service.context(id,chain.account.address)).snapshot
    const amounts=amountsForLiquidity(s.liquidity,s.sqrtPrice,s.minTick,s.maxTick)
    for(const [i,token] of [s.token0,s.token1].entries())await chain.send(token.address,encodeFunctionData({abi,functionName:'approve',args:[s.adapter,[amounts.amount0,amounts.amount1][i]*101n/100n+1n]}))
    const payload=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],[amounts.amount0*995n/1000n,amounts.amount1*995n/1000n,BigInt(s.headTimestamp+300)])
    const deposit=await chain.send(s.vault,encodeFunctionData({abi,functionName:'deposit',args:[0n,0n,payload]}))
    assert.equal((await service.recordUserAction(id,chain.account.address,deposit.transactionHash)).action,'deposit')
    s=(await service.context(id,chain.account.address)).snapshot
    assert.ok(BigInt(s.adapterLiquidity)>0n)
    assert.equal(s.claimBalance,'1');assert.equal(s.fixedBalance,'0')
    assert.throws(()=>positionAction(s,'withdraw'),/not matured/)
    const action=positionAction(s,'claim'),claimed=await chain.send(action.to,action.data)
    assert.equal((await service.recordUserAction(id,chain.account.address,claimed.transactionHash)).action,'claim')
    s=(await service.context(id,chain.account.address)).snapshot
    assert.equal(s.claimBalance,'0');assert.equal(s.fixedBalance,'1')
    assert.throws(()=>positionAction(s,'claim'),/No started claim/)
    offset=Number(s.endTime)*1000-Date.now()+3000
    await chain.raw('evm_setNextBlockTimestamp',[Number(s.endTime)+2]);await chain.raw('evm_mine');await chain.raw('evm_mine')
    row=await service.detail(id,chain.account.address);assert.equal(row.state,'matured')
    const withdraw=positionAction(row.observation,'withdraw',Date.now()+offset)
    const receipt=await chain.send(withdraw.to,withdraw.data)
    assert.equal(receipt.status,'success')
    assert.equal((await service.recordUserAction(id,chain.account.address,receipt.transactionHash)).action,'withdraw')
    row=await service.detail(id,chain.account.address)
    assert.equal(row.state,'completed');assert.equal(row.observation.adapterLiquidity,'0')
    await db.execution.approveOperation(id,chain.account.address,row.planHash,'collect')
    assert.equal((await worker.tick()).state,'collected')
    const budget=(await db.catalog(true)).budgets[0]
    assert.equal(budget.allocatedRaw,row.plan.premium);assert.equal((await db.auditBudget(budget.id)).valid,true)
  }finally{await store.close();await chain.close()}
})

it('real pre-start LP recovery follows current claim ownership and preserves the reserved premium until retirement',{timeout:120000},async()=>{
  const chain=await evmFixture({realPositionManager:true}),store=await incentivesFixture(),db=store.database
  try{
    const limit=10n**30n+''
    await store.seed(chain.account.address,limit,{pool:chain.pool});await db.execution.heartbeat(chain.account.address)
    const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,origin:ORIGIN})
    const id=(await store.accept(chain.account,await service.quote(chain.account.address,'cashcat-3d','100'))).id
    const worker=createCreator({database:db,rpc:chain.rpc,account:chain.account,config:chain.config})
    assert.equal((await worker.tick()).state,'created')
    let s=(await service.context(id,chain.account.address)).snapshot
    const amounts=amountsForLiquidity(s.liquidity,s.sqrtPrice,s.minTick,s.maxTick)
    for(const [i,token] of [s.token0,s.token1].entries())await chain.send(token.address,encodeFunctionData({abi,functionName:'approve',args:[s.adapter,[amounts.amount0,amounts.amount1][i]*101n/100n+1n]}))
    // The unrestricted protocol permits underfunded entry; reproduce a funding/entry race.
    const payload=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],[0n,0n,BigInt(s.headTimestamp+300)])
    const deposited=await chain.send(s.vault,encodeFunctionData({abi,functionName:'deposit',args:[0n,0n,payload]}))
    await service.recordUserAction(id,chain.account.address,deposited.transactionHash)
    let row=await service.detail(id,chain.account.address)
    assert.equal(row.state,'fixed_awaiting_funding');assert.equal(row.canRecover,true)
    s=row.observation;assert.throws(()=>positionAction(s,'claim'),/No started claim/)
    const recipient=privateKeyToAccount(generatePrivateKey()),tokenAbi=parseAbi(['function transfer(address,uint256) returns(bool)'])
    await chain.send(s.claimToken,encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[recipient.address,1n]}))
    row=await service.detail(id,chain.account.address)
    assert.equal(row.canRecover,false);assert.notEqual(row.state,'completed')
    assert.throws(()=>positionAction(row.observation,'recover'),/no pre-start deposit/)
    await chain.raw('anvil_setBalance',[recipient.address,toHex(10n**18n)])
    const other=createWalletClient({account:recipient,chain:chain.client.chain,transport:http(chain.url)})
    const returned=await other.sendTransaction({to:s.claimToken,data:encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[chain.account.address,1n]})})
    await chain.client.waitForTransactionReceipt({hash:returned});await chain.raw('evm_mine')
    row=await service.detail(id,chain.account.address)
    const action=positionAction(row.observation,'recover'),receipt=await chain.send(action.to,action.data)
    assert.equal((await service.recordUserAction(id,chain.account.address,receipt.transactionHash)).action,'recover')
    row=await service.detail(id,chain.account.address)
    assert.equal(row.observation.adapterLiquidity,'0');assert.equal(row.observation.claimBalance,'0')
    assert.equal(row.state,'awaiting_funding');assert.equal(row.canRecover,false)
    assert.equal((await db.catalog(true)).budgets[0].reservedRaw,row.plan.premium)
    await db.execution.approveOperation(id,chain.account.address,row.planHash,'retire')
    assert.equal((await worker.tick()).state,'retired')
    assert.equal((await db.catalog(true)).budgets[0].availableRaw,limit)
  }finally{await store.close();await chain.close()}
})
