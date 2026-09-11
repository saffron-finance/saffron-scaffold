import { it } from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { encodeFunctionData,createWalletClient,http,toHex } from 'viem'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { incentivesFixture,program,ORIGIN } from './incentives-fixture.mjs'
import { evmFixture,CASHCAT } from './evm-fixture.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { createCreator } from '../worker/creator.mjs'
import { abi } from '../shared/vault-lifecycle.mjs'
import { proofHash } from '../shared/payment.mjs'

it('treasury holdings cannot be assigned twice; externally funded premiums produce a canonical copyable brief',{timeout:120000},async()=>{
  const chain=await evmFixture(),f=await incentivesFixture(),db=f.database,treasury=privateKeyToAccount(generatePrivateKey())
  const service=createIncentivesService({database:db,rpc:chain.rpc,config:chain.config,usdQuote:chain.usdQuote,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
  const wallet=createWalletClient({account:treasury,chain:chain.client.chain,transport:http(chain.url)})
  const assign=(budgetId,limitRaw,revision=0)=>service.assignTreasury({budgetId,wallet:treasury.address,limitRaw:String(limitRaw),revision,reason:'Reviewed test treasury allocation',requestKey:randomUUID()},chain.account.address)
  async function send(to,data){const hash=await wallet.sendTransaction({to,data});await chain.client.waitForTransactionReceipt({hash});await chain.raw('evm_mine');return hash}
  try{
    await f.seed(chain.account.address,10n**30n+'')
    await chain.raw('anvil_setBalance',[treasury.address,toHex(10n**20n)])
    await chain.send(CASHCAT,encodeFunctionData({abi:chain.tokenAbi,functionName:'mint',args:[treasury.address,2n*10n**24n]}))
    assert.deepEqual((await service.treasuryStatus()).missing,[program.budgetPoolId])
    const other={...(await db.catalog(true)).budgets[0],id:'other',revision:0,name:'Second campaign',limitRaw:(10n**30n).toString()}
    await db.saveBudget(other,chain.account.address);await db.saveProgram({...program,id:'other-program',budgetPoolId:'other'},chain.account.address)
    const concurrent=await Promise.allSettled([assign(program.budgetPoolId,15n*10n**23n),assign('other',15n*10n**23n)])
    assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1)
    const first=(await db.treasuryBook())[0]
    await assign(first.budget_pool_id,10n**24n,first.revision)
    await assign(first.budget_pool_id==='other'?program.budgetPoolId:'other',10n**24n)
    const covered=await service.treasuryStatus();assert.equal(covered.available,true);assert.equal(Object.keys(covered.balances).length,1)
    await chain.prepareIntake(db)
    const {id}=await chain.accept(service)
    await assert.rejects(assign(program.budgetPoolId,1n,(await db.treasuryBook()).find(a=>a.budget_pool_id===program.budgetPoolId).revision),/outstanding premiums/)
    assert.equal((await createCreator({database:db,rpc:chain.rpc,account:chain.account,config:chain.config}).tick()).state,'created')
    let brief=await service.fundingBrief(id,chain.account.address)
    assert.equal(brief.canFund,true);assert.equal(brief.observedSupplyRaw,'0');assert.equal(brief.outstandingRaw,brief.totalRaw);assert.equal(brief.treasuryWallet,treasury.address.toLowerCase())
    const beforeFunding=await chain.raw('evm_snapshot'),amount=BigInt(brief.totalRaw),part=amount/2n
    await send(CASHCAT,encodeFunctionData({abi,functionName:'approve',args:[brief.vault,amount]}))
    await send(brief.vault,encodeFunctionData({abi,functionName:'deposit',args:[part,1n,'0x']}))
    brief=await service.fundingBrief(id,chain.account.address)
    assert.equal(brief.observedSupplyRaw,part.toString());assert.equal(brief.outstandingRaw,(amount-part).toString())
    assert.equal((await service.detail(id,chain.account.address)).depositable,false)
    await db.query("UPDATE saffron_incentives.deployment_intents SET created_at=NOW()-INTERVAL '2 days' WHERE id=$1",[id])
    assert.equal((await service.readiness()).reasons.includes('service_window_exceeded'),true)
    assert.equal((await service.operatorStatus()).metrics.fundingBacklog,1)
    assert.equal((await service.treasuryStatus()).available,true,'canonically spent allocation is no longer counted in wallet inventory')
    await send(brief.vault,encodeFunctionData({abi,functionName:'deposit',args:[amount-part,1n,'0x']}))
    brief=await service.fundingBrief(id,chain.account.address)
    assert.equal(brief.outstandingRaw,'0');assert.equal(brief.canFund,false);assert.equal((await service.detail(id,chain.account.address)).depositable,true)
    assert.equal((await service.readiness()).reasons.includes('service_window_exceeded'),false,'a delivered vault waiting for the user is outside the operator service window')
    assert.equal((await service.operatorStatus()).metrics.fundingBacklog,0)
    const bearer=await chain.client.readContract({address:brief.vault,abi,functionName:'variableBearerToken'})
    assert.equal(await chain.client.readContract({address:bearer,abi,functionName:'balanceOf',args:[treasury.address]}),amount)
    assert.equal(await chain.client.readContract({address:bearer,abi,functionName:'balanceOf',args:[chain.account.address]}),0n)
    assert.equal(chain.broadcasts,3)
    assert.doesNotMatch(JSON.stringify(brief),/recoverySecret|raw_tx|privateKey/)
    await chain.raw('evm_revert',[beforeFunding])
    await assert.rejects(service.treasuryStatus(),/canonical reconciliation/)
    assert.equal((await service.detail(id,chain.account.address)).depositable,false)
    await send(CASHCAT,encodeFunctionData({abi:chain.tokenAbi,functionName:'transfer',args:[chain.feeRecipient,1n]}))
    const deficient=await service.treasuryStatus();assert.equal(deficient.available,false);assert.equal(deficient.insufficient.length,1)
    const count=(await db.query('SELECT count(*)::int n FROM saffron_incentives.deployment_quotes')).rows[0].n
    await assert.rejects(service.quote(chain.account.address,program.id,'100',proofHash(chain.recoverySecret)),/paused/)
    assert.equal((await db.query('SELECT count(*)::int n FROM saffron_incentives.deployment_quotes')).rows[0].n,count)
  }finally{await f.close();await chain.close()}
})
