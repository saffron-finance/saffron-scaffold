import { it } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile,readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { incentivesFixture,ORIGIN } from './incentives-fixture.mjs'
import { evmFixture } from './evm-fixture.mjs'
import { privateFilesFixture } from './private-files-fixture.mjs'
import { createIncentivesService } from '../server/incentives-service.mjs'
import { createCreator } from '../worker/creator.mjs'
import { freezeRestoredDatabase,inspectRestoredDatabase } from '../server/restore-verification.mjs'
import { generatePrivateKey,privateKeyToAccount } from 'viem/accounts'
import { createWalletClient,http,toHex } from 'viem'
import { paymentData,proofHash } from '../shared/payment.mjs'

/** PostgreSQL tools see only generated test database names. The archive contains
 * protected recovery data and is never printed, checked in or served. */
function pgTool(tool,connection,input){
  if(!/^saffron_incentives_test_[0-9a-f]{16}$/.test(connection.database))throw new Error('A disposable database is required.')
  const container=process.env.SAFFRON_TEST_PG_CONTAINER
  if(container&&!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container))throw new Error('Invalid test database container.')
  const options=tool==='pg_dump'?['--format=custom','--no-owner','--no-acl']:['--clean','--if-exists','--no-owner','--no-acl','--exit-on-error']
  const args=[...options,'-U',connection.user,'--dbname',connection.database]
  if(!container)args.push('-h',connection.host,'-p',String(connection.port))
  return new Promise((resolve,reject)=>{
    const child=spawn(container?'docker':tool,container?['exec','-i',container,tool,...args]:args,{windowsHide:true,env:{...process.env,PGPASSWORD:connection.password??''},stdio:['pipe','pipe','pipe']})
    const output=[];let size=0
    child.stdout.on('data',data=>{size+=data.length;if(size>32*1024*1024){child.kill();reject(new Error('Disposable database backup is too large.'))}else output.push(data)})
    child.stderr.resume();child.on('error',()=>reject(new Error('PostgreSQL backup/restore tools are required.')))
    child.on('close',code=>code===0?resolve(Buffer.concat(output)):reject(new Error('Disposable PostgreSQL backup/restore failed.')))
    child.stdin.on('error',()=>{});child.stdin.end(input)
  })
}

it('restored backups stay paused and detect later signer activity instead of creating a second vault',{timeout:120000},async()=>{
  const chain=await evmFixture(),source=await incentivesFixture(),target=await incentivesFixture(),files=await privateFilesFixture('saffron-backup-test-')
  try{
    await source.seed(chain.account.address,10n**30n+'');await chain.prepareIntake(source.database)
    const service=createIncentivesService({database:source.database,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    const payer=privateKeyToAccount(generatePrivateKey()),wallet=createWalletClient({account:payer,chain:chain.client.chain,transport:http(chain.url)})
    await chain.raw('anvil_setBalance',[payer.address,toHex(10n**20n)])
    const quote=await service.quote(payer.address,'cashcat-3d','100',proofHash(chain.recoverySecret))
    const hash=await wallet.sendTransaction({to:quote.fee.recipient,data:paymentData(quote),value:BigInt(quote.fee.amountWei)})
    await chain.client.waitForTransactionReceipt({hash});await chain.raw('evm_mine')
    const {id}=await service.acceptPayment(quote.id,hash,chain.recoverySecret)
    const backup=join(files.directory,'database.backup')
    await writeFile(backup,await pgTool('pg_dump',source.connection),{mode:0o600})
    await pgTool('pg_restore',target.connection,await readFile(backup))
    await freezeRestoredDatabase(target.database)
    assert.equal((await target.database.intakePolicy(chain.account.address)).enabled,false)
    assert.equal((await target.database.catalog(true)).budgets[0].paused,true)
    let comparison=await inspectRestoredDatabase({db:target.database,rpc:chain.rpc})
    assert.equal(comparison.recordedEvidenceMatches,true,JSON.stringify(comparison));assert.equal(comparison.activationAllowed,false)
    assert.equal((await createCreator({database:source.database,rpc:chain.rpc,account:chain.account,config:chain.config}).tick()).state,'created')
    comparison=await inspectRestoredDatabase({db:target.database,rpc:chain.rpc})
    assert.equal(comparison.recordedEvidenceMatches,false)
    assert.equal(comparison.problems.some(p=>p.kind==='signer_nonce_requires_reconciliation'),true)
    const broadcasts=chain.broadcasts
    assert.equal((await createCreator({database:target.database,rpc:chain.rpc,account:chain.account,config:chain.config}).tick()).state,'waiting')
    assert.equal(chain.broadcasts,broadcasts);assert.equal((await target.database.execution.transactions(id)).length,0)
    assert.equal((await target.database.getIntent(id)).cancel_requested,false)
    assert.doesNotMatch(JSON.stringify(comparison),/privateKey|raw_tx|recoverySecret|rpcUrl/)

    // A later complete backup carries terminal refunds and their execution stop,
    // allocations and audit, even when the creator and verifier are restarted.
    const payment=await source.database.paymentObligation(hash)
    await service.refunds.approve(hash,{operator:chain.account.address,revision:payment.revision,requestKey:randomUUID(),reason:'Premium cannot be provided'}, {category:'funding_unavailable',fundingStopped:true})
    const refundSource=chain.feeRecipient
    const batch=await service.refunds.prepare({source:refundSource,payments:[hash],requestKey:randomUUID()},chain.account.address)
    await chain.raw('anvil_setBalance',[refundSource,toHex(10n**18n)]);await chain.raw('anvil_impersonateAccount',[refundSource])
    const payout=await chain.raw('eth_sendTransaction',[{from:refundSource,to:payer.address,value:toHex(BigInt(payment.amount_wei)),gas:'0x5208'}]);await chain.raw('evm_mine',[])
    await service.refunds.submit(batch.id,[payout],chain.account.address);await service.refunds.poll()
    assert.equal((await source.database.paymentObligation(hash)).state,'refunded')
    await pgTool('pg_restore',target.connection,await pgTool('pg_dump',source.connection))
    await freezeRestoredDatabase(target.database)
    assert.equal((await target.database.paymentObligation(hash)).execution_allowed,false)
    const restored=createIncentivesService({database:target.database,rpc:chain.rpc,usdQuote:chain.usdQuote,config:chain.config,signer:chain.account.address,feeRecipient:chain.feeRecipient,origin:ORIGIN})
    assert.equal((await restored.refunds.detail(batch.id)).outstandingWei,'0')
    assert((await target.database.query('SELECT 1 FROM saffron_incentives.refund_verification_audit WHERE hash=$1',[payout])).rowCount>0)
    await target.database.query('UPDATE saffron_incentives.refund_submissions SET checked_at=NULL')
    await restored.refunds.poll()
    assert.equal((await target.database.paymentObligation(hash)).state,'refunded')
    const afterRefund=chain.broadcasts
    assert.equal((await createCreator({database:target.database,rpc:chain.rpc,account:chain.account,config:chain.config}).tick()).state,'idle')
    assert.equal(chain.broadcasts,afterRefund)
  }finally{await source.close();await target.close();await chain.close();await files.close()}
})
