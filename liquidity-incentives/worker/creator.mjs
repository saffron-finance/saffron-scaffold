import { randomUUID } from 'node:crypto'
import { decodeEventLog, decodeFunctionResult, encodeFunctionData, keccak256 } from 'viem'
import { abi, CHAIN_ID, FACTORY, sameAddress } from '../shared/vault-lifecycle.mjs'
import { verifyPayment } from '../server/payment-proof.mjs'
import { digest } from '../shared/incentives.mjs'
import { readVault } from '../shared/vault-reader.mjs'
import { legacyGasPrice } from './gas-policy.mjs'
export { resolvePlan } from '../shared/deployment-plan.mjs'

const jsonSafe = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item))
class Waiting extends Error {}
class ConfirmedFailure extends Error {}
const read = async (rpc, address, functionName, args = [], block = 'latest') =>
  decodeFunctionResult({ abi, functionName, data: await rpc('eth_call', [{ to: address,
    data: encodeFunctionData({ abi, functionName, args }) }, block]) })

/** Execute at most one leased job; durable signed bytes precede every broadcast.
 * The injected account lives only in this worker, never the HTTP process.
 */
export function createCreator({ database, rpc, account, config, usdQuote, requestId=null,retirementOnly=false,beforeSign }) {
  if(retirementOnly&&!requestId)throw new Error('Retirement requires one pinned request.')
  const owner = randomUUID()
  async function tick() {
    await database.execution.expireQueued()
    if(!requestId)await database.execution.heartbeat(account.address)
    const lock = await database.execution.signerLock(account.address)
    if (!lock) return { state: 'locked' }
    let job
    try {
      job = await database.execution.claim(account.address, owner, requestId)
      if (!job) return { state: 'idle' }
      if (!sameAddress(job.signer, account.address) || !sameAddress(job.factory, FACTORY) || job.chain_id !== CHAIN_ID) throw new ConfirmedFailure('Job signer, factory or chain mismatch.')
      if(requestId&&(job.intent_id!==requestId||(retirementOnly?job.operation!=='retire':job.operation!=='create'||job.resume_version!==0))) throw new ConfirmedFailure('Pinned execution scope does not match this operation.')
      if (BigInt(await rpc('eth_chainId', [])) !== BigInt(CHAIN_ID)) throw new ConfirmedFailure('Wrong deployer chain.')
      if (!job.plan || digest(job.accepted_plan) !== digest(Object.fromEntries(Object.keys(job.accepted_plan).map(key => [key,job.plan[key]])))) throw new ConfirmedFailure('Accepted deployment plan changed.')
      const plan = job.plan
      // A valid payment does not authorize a different registered type or a
      // larger premium than the worker operator reviewed.
      if(plan.factoryCodeHash!==config.factoryCodeHash||plan.vaultTypeHash!==config.vaultTypeHash||plan.adapterTypeHash!==config.adapterTypeHash
        ||String(plan.vaultTypeId)!==String(config.vaultTypeId)||String(plan.adapterTypeId)!==String(config.adapterTypeId)
        ||BigInt(plan.premium)<=0n||BigInt(plan.premium)>BigInt(config.maxPremiumRaw))throw new ConfirmedFailure('Plan is outside the configured factory/type/premium policy.')
      async function guard() { await lock.assert(); await database.execution.renew(job.intent_id, owner) }
      async function savePlan() { await database.execution.setPlan(job.intent_id, owner, plan) }
      async function receiptFor(tx) {
        const hash=tx.resolved_hash??tx.hash
        const receipt = await rpc('eth_getTransactionReceipt', [hash])
        if (!receipt) return null
        const mined = await rpc('eth_getTransactionByHash', [hash])
        const intended = tx.transaction_data
        const matching=tx.resolution_kind==='cancelled'
          ? sameAddress(mined?.to,account.address)&&mined.input==='0x'&&BigInt(mined.value)===0n
          : sameAddress(mined?.to,intended.to)&&mined.input===intended.data&&BigInt(mined.value)===BigInt(intended.value)
        if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || !mined || mined.hash?.toLowerCase()!==hash.toLowerCase()
          ||mined.blockHash!==receipt.blockHash||mined.blockNumber!==receipt.blockNumber
          ||!sameAddress(mined.from, account.address) || !matching || BigInt(mined.nonce) !== BigInt(tx.nonce)) throw new Waiting('Transaction evidence does not match the saved action.')
        const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
        const head = BigInt(await rpc('eth_blockNumber', []))
        if (block?.hash !== receipt.blockHash || head < BigInt(receipt.blockNumber) + BigInt(config.confirmations - 1)) throw new Waiting('Waiting for canonical transaction confirmations.')
        await database.execution.saveReceipt(tx.hash, receipt)
        return tx.resolution_kind==='cancelled'?{...receipt,status:'0x0',cancelled:true}:receipt
      }
      async function transact(step, to, data) {
        await guard()
        let tx = await database.execution.lastTransaction(job.intent_id, step)
        if (tx) {
          const receipt = await receiptFor(tx)
          if (receipt?.status === '0x1') return receipt
          if (receipt?.status === '0x0') {
            if (tx.resume_version >= job.resume_version) throw new ConfirmedFailure('Transaction reverted. Inspect and approve Resume.')
            tx = null // A new nonce is allowed only after explicit resume of a proven revert.
          }
        }
        if (!tx) {
          if(retirementOnly)throw new ConfirmedFailure('Retirement cannot authorize a new signature.')
          // Revalidate the payer's canonical receipt before each new gas spend.
          // Existing signed transactions still reconcile even if the fee reorgs.
          const quote=await database.quote(job.quote_id)
          // The fee commits to these terms, not merely a queue row's ID. Check
          // every immutable copy before spending gas; a changed snapshot must
          // fail before adapter creation, even if the cached plan is unchanged.
          const committed=quote&&digest({snapshot:quote.snapshot,plan:quote.plan,signer:quote.signer,
            programRevision:quote.programRevision,pairRevision:quote.pairRevision,budgetRevision:quote.budgetRevision})
          if(!quote||committed!==quote.planHash||quote.planHash!==job.plan_hash
            ||digest(quote.snapshot)!==digest(job.snapshot)||digest(quote.plan)!==digest(job.accepted_plan)
            ||quote.signer!==job.signer||quote.wallet!==job.wallet)throw new ConfirmedFailure('Payment-bound request terms changed.')
          const proof=(await database.query('SELECT hash FROM saffron_incentives.payment_proofs WHERE quote_id=$1',[job.quote_id])).rows[0]
          if(!proof)throw new ConfirmedFailure('Creation payment is missing.')
          const payment=await verifyPayment(quote,proof.hash,null,rpc,{confirmations:config.confirmations,checkCapability:false})
          const obligation=await database.paymentObligation(proof.hash)
          const override=obligation?.admission_override
          if(!obligation?.execution_allowed||payment.late&&!(override?.hash===proof.hash&&override.quoteId===quote.id&&override.planHash===job.plan_hash))throw new ConfirmedFailure('Creation payment requires operator resolution before execution.')
          const head=await rpc('eth_getBlockByNumber',['latest',false]),headTime=Number(BigInt(head?.timestamp??'0'))*1000
          if(!Number.isFinite(headTime)||Date.now()-headTime>60000||headTime>Date.now()+5000)throw new Waiting('Fresh canonical chain head is required before signing.')
          await database.execution.authorizeStep(job.intent_id,owner,{allowRetirement:job.operation==='retire'})
          // Verify current factory/type identity again before signing a new step.
          const code = await rpc('eth_getCode',[FACTORY,'latest'])
          const types = await Promise.all([read(rpc, FACTORY, 'vaultTypeByteCode', [BigInt(plan.vaultTypeId)]), read(rpc, FACTORY, 'adapterTypeByteCode', [BigInt(plan.adapterTypeId)])])
          if (keccak256(code) !== config.factoryCodeHash || keccak256(types[0]) !== plan.vaultTypeHash || keccak256(types[1]) !== plan.adapterTypeHash) throw new ConfirmedFailure('Factory code or registered type changed.')
          if((await read(rpc,FACTORY,'feeBps')).toString()!==String(plan.feeBps))throw new ConfirmedFailure('Factory fee changed after the accepted plan.')
          const from = account.address
          const nonce = Number(BigInt(await rpc('eth_getTransactionCount', [from, 'pending'])))
          if (!Number.isSafeInteger(nonce)) throw new ConfirmedFailure('Invalid signer nonce.')
          // Leave fee headroom only when signing a new transaction. Recovery
          // continues to use the exact journaled bytes, hash and nonce.
          const suggestedGasPrice = await rpc('eth_gasPrice', [])
          let gasPrice
          try { gasPrice = legacyGasPrice({ suggested: suggestedGasPrice, baseFee: head.baseFeePerGas ?? '0x0', maximum: config.maxGasPriceWei }) }
          catch { throw new ConfirmedFailure('Gas price headroom exceeds the configured operator budget.') }
          const gas = (BigInt(await rpc('eth_estimateGas', [{ from, to, data, value: '0x0' }])) * 120n + 99n) / 100n
          if (gas > BigInt(config.maxGasPerTx) || gasPrice > BigInt(config.maxGasPriceWei)) throw new ConfirmedFailure('Gas exceeds the configured operator budget.')
          const transaction = { chainId: CHAIN_ID, type: 'legacy', nonce, to, data, value: 0n, gas, gasPrice }
          // An operator-scoped one-shot guard can narrow the ordinary worker to
          // one request and one attempt per factory step before any key use.
          try{await beforeSign?.({job,step,transaction})}
          catch{throw new ConfirmedFailure('One-shot signing gate rejected this transaction.')}
          const raw = await account.signTransaction(transaction), hash = keccak256(raw)
          await guard()
          await database.execution.saveTransaction({ requestId: job.intent_id, step, resumeVersion: job.resume_version,
            owner, signer: from, nonce, hash, raw, transaction: jsonSafe(transaction), maxDailyGasWei: config.maxDailyGasWei })
          tx = { hash, raw_tx: raw, nonce, transaction_data: jsonSafe(transaction) }
        }
        await guard()
        const usedNonce = BigInt(await rpc('eth_getTransactionCount', [account.address, 'latest']))
        if (usedNonce > BigInt(tx.nonce)) throw new Waiting('Nonce used but transaction outcome is unknown. Reconciliation required.')
        try {
          const hash = await rpc('eth_sendRawTransaction', [tx.raw_tx])
          if (hash.toLowerCase() !== tx.hash.toLowerCase()) throw new Error('Hash mismatch')
        } catch { /* The exact stored transaction is reconciled next tick, never replaced blindly. */ }
        const receipt = await receiptFor(tx)
        if (!receipt) throw new Waiting('Transaction broadcast; awaiting confirmation.')
        if (receipt.status !== '0x1') throw new ConfirmedFailure('Transaction reverted. Inspect and approve Resume.')
        return receipt
      }
      function event(receipt, name) {
        const decoded = receipt.logs.filter(log => sameAddress(log.address, FACTORY) && !log.removed).flatMap(log => {
          try { const value = decodeEventLog({ abi, data: log.data, topics: log.topics }); return value.eventName === name ? [value.args] : [] } catch { return [] }
        })
        if (decoded.length !== 1 || !sameAddress(decoded[0].creator, account.address)) throw new ConfirmedFailure('Factory event identity did not match.')
        return decoded[0]
      }
      if (job.operation === 'retire') {
        // Resolve every previously signed transaction, including broadcasts whose
        // response was lost. A clock or user cancellation never proves non-execution.
        for (const tx of await database.execution.transactions(job.intent_id)) {
          let receipt=await receiptFor(tx)
          if(!receipt){
            await guard()
            const used=BigInt(await rpc('eth_getTransactionCount',[account.address,'latest']))
            if(used>BigInt(tx.nonce))throw new Waiting('Unknown nonce outcome must be reconciled before retirement.')
            try{await rpc('eth_sendRawTransaction',[tx.raw_tx])}catch{}
            receipt=await receiptFor(tx)
            if(!receipt)throw new Waiting('Waiting for the saved transaction before retirement.')
          }
        }
        let evidence={transactionHashes:(await database.execution.transactions(job.intent_id)).map(tx=>tx.hash)}
        if(plan.vault && await read(rpc,plan.vault,'initialized')) {
          let snapshot=await readVault(job,rpc,{confirmations:config.confirmations})
          if(snapshot.isStarted||BigInt(snapshot.claimSupply)>0n)throw new ConfirmedFailure('The fixed position must be empty and the vault unstarted before retirement.')
          if(BigInt(snapshot.variableSupply)>0n)throw new ConfirmedFailure('External funding must be recovered by its owner before retiring this vault.')
          if(snapshot.isStarted||BigInt(snapshot.claimSupply)!==0n||BigInt(snapshot.variableSupply)!==0n)throw new Waiting('Recovery is not yet confirmed.')
          evidence={...evidence,blockNumber:snapshot.blockNumber,blockHash:snapshot.blockHash,vault:plan.vault}
        }
        // Even a partially created vault is harmless to the budget once all signed
        // work is settled and this intent can never authorize another funding job.
        await guard()
        evidence.transactionHashes=(await database.execution.transactions(job.intent_id)).map(tx=>tx.hash)
        await database.execution.retire(job.intent_id,owner,evidence)
        return {state:'retired',deploymentId:job.intent_id}
      }
      if (job.operation === 'create') {
        const adapterReceipt = await transact('create-adapter', FACTORY, encodeFunctionData({ abi, functionName: 'createAdapter', args: [BigInt(plan.adapterTypeId), job.snapshot.poolAddress, '0x'] }))
        const adapterEvent = event(adapterReceipt, 'AdapterCreated')
        if (!sameAddress(adapterEvent.pool,job.snapshot.poolAddress) || adapterEvent.adapterTypeId.toString() !== plan.adapterTypeId) throw new ConfirmedFailure('Adapter terms mismatch.')
        plan.adapter = adapterEvent.adapter.toLowerCase(); plan.adapterId = adapterEvent.id.toString()
        plan.adapterCodeHash = keccak256(await rpc('eth_getCode', [plan.adapter, adapterReceipt.blockNumber])); await savePlan()
        const vaultReceipt = await transact('create-vault', FACTORY, encodeFunctionData({ abi, functionName: 'createVault', args: [BigInt(plan.vaultTypeId), plan.adapter] }))
        const vaultEvent = event(vaultReceipt, 'VaultCreated')
        if (!sameAddress(vaultEvent.adapter,plan.adapter) || vaultEvent.vaultTypeId.toString() !== plan.vaultTypeId) throw new ConfirmedFailure('Vault terms mismatch.')
        plan.vault = vaultEvent.vault.toLowerCase(); plan.vaultId = vaultEvent.vaultId.toString()
        plan.vaultCodeHash = keccak256(await rpc('eth_getCode', [plan.vault, vaultReceipt.blockNumber])); await savePlan()
        await transact('initialize-vault', FACTORY, encodeFunctionData({ abi, functionName: 'initializeVault',
          args: [BigInt(plan.vaultId),BigInt(plan.liquidity),BigInt(plan.premium),BigInt(job.snapshot.durationSeconds),job.snapshot.variableAssetAddress,BigInt(plan.feeBps)] }))
        const snapshot = await readVault(job, rpc, { confirmations: config.confirmations })
        await database.execution.markCreated(job.intent_id, owner, snapshot)
        return { state: 'created', requestId: job.intent_id }
      }
      throw new ConfirmedFailure('This worker only creates and retires vaults. Premium custody is external.')
    } catch (error) {
      if (job) {
        const waiting = error instanceof Waiting || !(error instanceof ConfirmedFailure)
        const reason = error instanceof Waiting || error instanceof ConfirmedFailure ? error.message : 'Worker/RPC unavailable; all saved transactions retained.'
        await database.execution.setState(job.intent_id, owner, job.state === 'created' ? 'created' : waiting ? 'waiting' : 'failed',
          job.state === 'created' ? waiting ? 'waiting' : 'failed' : job.funding_state, reason)
        return { state: waiting ? 'waiting' : 'failed', requestId: job.intent_id, reason }
      }
      throw error
    } finally { await lock.release() }
  }
  return { tick }
}
