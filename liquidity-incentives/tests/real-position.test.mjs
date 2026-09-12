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
    await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
    const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN,now:()=>Date.now()+offset})
    const id=(await chain.accept(service)).id
    const worker=createCreator({database:db,rpc:chain.rpc,account:chain.account,config:chain.config})
    assert.equal((await worker.tick()).state,'created')
    let row=await service.detail(id,chain.account.address)
    await chain.fund(row)
    assert.equal((await worker.tick()).state,'idle')
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
    // Treasury collection is external; no collection job can block the LP.
    await assert.rejects(db.execution.approveOperation(id,chain.account.address,row.planHash,'collect'),e=>e.status===400)
    const action=positionAction(s,'claim'),claimed=await chain.send(action.to,action.data)
    assert.equal((await service.recordUserAction(id,chain.account.address,claimed.transactionHash)).action,'claim')
    s=(await service.context(id,chain.account.address)).snapshot
    assert.equal(s.claimBalance,'0');assert.equal(s.fixedBalance,'1')
    assert.throws(()=>positionAction(s,'claim'),/No started claim/)
    offset=Number(s.endTime)*1000-Date.now()+3000
    await chain.raw('evm_setNextBlockTimestamp',[Number(s.endTime)+2]);await chain.raw('evm_mine');await chain.raw('evm_mine')
    row=await service.detail(id,chain.account.address);assert.equal(row.state,'matured')
    assert.equal(row.canWithdraw,true)
    const withdraw=positionAction(row.observation,'withdraw',Date.now()+offset)
    const receipt=await chain.send(withdraw.to,withdraw.data)
    assert.equal(receipt.status,'success')
    assert.equal((await service.recordUserAction(id,chain.account.address,receipt.transactionHash)).action,'withdraw')
    row=await service.detail(id,chain.account.address)
    assert.equal(row.state,'completed');assert.equal(row.observation.adapterLiquidity,'0')
    await chain.send(row.plan.vault,encodeFunctionData({abi,functionName:'withdraw',args:[1n,'0x']}))
    assert.equal((await worker.tick()).state,'idle')
    const budget=(await db.catalog(true)).budgets[0]
    assert.equal(budget.allocatedRaw,row.plan.premium);assert.equal((await db.auditBudget(budget.id)).valid,true)
  }finally{await store.close();await chain.close()}
})

it('real pre-start LP recovery follows current claim ownership and preserves the reserved premium without a retirement workflow',{timeout:120000},async()=>{
  const chain=await evmFixture({realPositionManager:true}),store=await incentivesFixture(),db=store.database
  try{
    const limit=10n**30n+''
    await store.seed(chain.account.address,limit,{pool:chain.pool});await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
    const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const id=(await chain.accept(service)).id
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
    assert.equal(row.workerState,'created');assert.equal(row.canRecover,true)
    s=row.observation;assert.throws(()=>positionAction(s,'claim'),/No started claim/)
    const recipient=privateKeyToAccount(generatePrivateKey()),tokenAbi=parseAbi(['function transfer(address,uint256) returns(bool)'])
    await chain.send(s.claimToken,encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[recipient.address,1n]}))
    row=await service.detail(id,chain.account.address)
    assert.equal(row.canRecover,false);assert.notEqual(row.state,'completed')
    assert.throws(()=>positionAction(row.observation,'recover'),/no pre-start deposit/)
    const received=(await service.list(recipient.address)).deployments.find(item=>item.id===id)
    assert.equal(received.canRecover,true);assert.equal(received.isRequester,false)
    assert.equal((await service.context(id,recipient.address)).job.wallet,recipient.address.toLowerCase())
    await assert.rejects(service.recordUserAction(id,recipient.address,deposited.transactionHash),error=>error.status===409)
    await chain.raw('anvil_setBalance',[recipient.address,toHex(10n**18n)])
    const other=createWalletClient({account:recipient,chain:chain.client.chain,transport:http(chain.url)})
    const recipientRecovery=positionAction((await service.detail(id,recipient.address)).observation,'recover')
    const recovered=await other.sendTransaction({to:recipientRecovery.to,data:recipientRecovery.data})
    await chain.client.waitForTransactionReceipt({hash:recovered});await chain.raw('evm_mine')
    assert.equal((await service.recordUserAction(id,recipient.address,recovered)).action,'recover')
    assert.equal((await service.detail(id,recipient.address)).depositable,false,'a holder does not gain deployment permissions')
    row=await service.detail(id,chain.account.address)
    assert.equal(row.observation.adapterLiquidity,'0');assert.equal(row.observation.claimBalance,'0')
    assert.equal(row.state,'awaiting_funding');assert.equal(row.canRecover,false)
    assert.equal((await db.catalog(true)).budgets[0].reservedRaw,row.plan.premium)
    assert.equal((await worker.tick()).state,'idle')
    assert.equal((await db.auditBudget('cashcat-campaign')).valid,true)
  }finally{await store.close();await chain.close()}
})

it('received claim and fixed bearer positions are discovered, reorg checked, claimed and withdrawn by their owners',{timeout:120000},async()=>{
  const chain=await evmFixture({realPositionManager:true}),store=await incentivesFixture(),db=store.database
  let offset=0
  try{
    await store.seed(chain.account.address,10n**30n+'',{pool:chain.pool});await db.execution.heartbeat(chain.account.address);await chain.prepareIntake(db)
    const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN,now:()=>Date.now()+offset})
    const id=(await chain.accept(service)).id
    const worker=createCreator({database:db,rpc:chain.rpc,account:chain.account,config:chain.config})
    await worker.tick()
    let row=await service.detail(id,chain.account.address)
    await chain.fund(row);await worker.tick()
    const s=(await service.context(id,chain.account.address)).snapshot,amounts=amountsForLiquidity(s.liquidity,s.sqrtPrice,s.minTick,s.maxTick)
    for(const [i,token] of [s.token0,s.token1].entries())await chain.send(token.address,encodeFunctionData({abi,functionName:'approve',args:[s.adapter,[amounts.amount0,amounts.amount1][i]*101n/100n+1n]}))
    const payload=encodeAbiParameters([{type:'uint256'},{type:'uint256'},{type:'uint256'}],[0n,0n,BigInt(s.headTimestamp+300)])
    await chain.send(s.vault,encodeFunctionData({abi,functionName:'deposit',args:[0n,0n,payload]}))
    const recipient=privateKeyToAccount(generatePrivateKey()),holder=privateKeyToAccount(generatePrivateKey())
    const tokenAbi=parseAbi(['function transfer(address,uint256) returns(bool)'])
    for(const account of [recipient,holder])await chain.raw('anvil_setBalance',[account.address,toHex(10n**18n)])
    const transfer=encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[recipient.address,1n]})
    const checkpoint=await chain.raw('evm_snapshot')
    await chain.send(s.claimToken,transfer);await service.poll()
    assert.equal((await service.list(recipient.address)).deployments[0].canClaim,true)
    await chain.raw('evm_revert',[checkpoint]);await chain.raw('evm_mine');await chain.raw('evm_mine')
    await service.poll()
    assert.equal((await service.list(recipient.address)).deployments.length,0,'orphaned transfers cannot grant profile access')
    await assert.rejects(service.detail(id,recipient.address),error=>error.status===404)
    await chain.send(s.claimToken,transfer);await service.poll()
    row=await service.detail(id,recipient.address)
    assert.equal(row.canClaim,true);assert.equal(row.wallet,chain.account.address.toLowerCase())
    await assert.rejects(service.detail(id,holder.address),error=>error.status===404)
    const wallet=createWalletClient({account:recipient,chain:chain.client.chain,transport:http(chain.url)})
    const claim=positionAction(row.observation,'claim'),claimed=await wallet.sendTransaction({to:claim.to,data:claim.data})
    await chain.client.waitForTransactionReceipt({hash:claimed});await chain.raw('evm_mine')
    assert.equal((await service.recordUserAction(id,recipient.address,claimed)).action,'claim')
    const sent=await wallet.sendTransaction({to:s.fixedBearerToken,data:encodeFunctionData({abi:tokenAbi,functionName:'transfer',args:[holder.address,1n]})})
    await chain.client.waitForTransactionReceipt({hash:sent});await chain.raw('evm_mine');await service.poll()
    row=(await service.list(holder.address)).deployments[0]
    assert.equal(row.state,'active');assert.equal(row.observation.fixedBalance,'1');assert.equal(row.canWithdraw,false)
    offset=Number(row.observation.endTime)*1000-Date.now()+3000
    await chain.raw('evm_setNextBlockTimestamp',[Number(row.observation.endTime)+2]);await chain.raw('evm_mine');await chain.raw('evm_mine')
    row=await service.detail(id,holder.address)
    const withdrawal=positionAction(row.observation,'withdraw',Date.now()+offset)
    const holderWallet=createWalletClient({account:holder,chain:chain.client.chain,transport:http(chain.url)})
    const withdrawn=await holderWallet.sendTransaction({to:withdrawal.to,data:withdrawal.data})
    await chain.client.waitForTransactionReceipt({hash:withdrawn});await chain.raw('evm_mine')
    assert.equal((await service.recordUserAction(id,holder.address,withdrawn)).deployment.state,'completed')
    assert.equal((await service.list(holder.address)).deployments[0].state,'completed')
    assert.equal((await service.detail(id,recipient.address)).canWithdraw,false)
  }finally{await store.close();await chain.close()}
})
