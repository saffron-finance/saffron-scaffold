import { randomUUID } from 'node:crypto'
import { decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256 } from 'viem'
import { abi, CHAIN_ID, FACTORY, sameAddress } from '../shared/vault-lifecycle.mjs'
import { digest } from '../shared/incentives.mjs'
import { readVault } from '../shared/vault-reader.mjs'
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
export function createCreator({ database, rpc, account, config, usdQuote }) {
  const owner = randomUUID()
  async function tick() {
    await database.execution.expireQueued()
    await database.execution.heartbeat(account.address)
    const lock = await database.execution.signerLock(account.address)
    if (!lock) return { state: 'locked' }
    let job
    try {
      job = await database.execution.claim(account.address, owner)
      if (!job) return { state: 'idle' }
      if (!sameAddress(job.signer, account.address) || !sameAddress(job.factory, FACTORY) || job.chain_id !== CHAIN_ID) throw new ConfirmedFailure('Job signer, factory or chain mismatch.')
      if (BigInt(await rpc('eth_chainId', [])) !== BigInt(CHAIN_ID)) throw new ConfirmedFailure('Wrong deployer chain.')
      if (!job.plan || digest(job.accepted_plan) !== digest(Object.fromEntries(Object.keys(job.accepted_plan).map(key => [key,job.plan[key]])))) throw new ConfirmedFailure('Accepted deployment plan changed.')
      const plan = job.plan
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
        if (receipt.transactionHash?.toLowerCase() !== hash.toLowerCase() || !mined || !sameAddress(mined.from, account.address) || !matching || BigInt(mined.nonce) !== BigInt(tx.nonce)) throw new Waiting('Transaction evidence does not match the saved action.')
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
          await database.execution.authorizeStep(job.intent_id,owner,{allowRetirement:job.operation==='retire'})
          // Verify current factory/type identity again before signing a new step.
          const code = await rpc('eth_getCode',[FACTORY,'latest'])
          const types = await Promise.all([read(rpc, FACTORY, 'vaultTypeByteCode', [BigInt(plan.vaultTypeId)]), read(rpc, FACTORY, 'adapterTypeByteCode', [BigInt(plan.adapterTypeId)])])
          if (keccak256(code) !== config.factoryCodeHash || keccak256(types[0]) !== plan.vaultTypeHash || keccak256(types[1]) !== plan.adapterTypeHash) throw new ConfirmedFailure('Factory code or registered type changed.')
          const from = account.address
          const nonce = Number(BigInt(await rpc('eth_getTransactionCount', [from, 'pending'])))
          if (!Number.isSafeInteger(nonce)) throw new ConfirmedFailure('Invalid signer nonce.')
          const gasPrice = BigInt(await rpc('eth_gasPrice', []))
          const gas = (BigInt(await rpc('eth_estimateGas', [{ from, to, data, value: '0x0' }])) * 120n + 99n) / 100n
          if (gas > BigInt(config.maxGasPerTx) || gasPrice > BigInt(config.maxGasPriceWei)) throw new ConfirmedFailure('Gas exceeds the configured operator budget.')
          const transaction = { chainId: CHAIN_ID, type: 'legacy', nonce, to, data, value: 0n, gas, gasPrice }
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
          if(BigInt(snapshot.variableSupply)>0n){
            const bearer=await read(rpc,plan.vault,'variableBearerToken')
            const owned=await read(rpc,bearer,'balanceOf',[account.address])
            if(owned!==BigInt(snapshot.variableSupply))throw new ConfirmedFailure('The funding wallet must recover all variable bearer tokens before retirement.')
            await transact('retire-premium',plan.vault,encodeFunctionData({abi,functionName:'withdraw',args:[1n,'0x']}))
            snapshot=await readVault(job,rpc,{confirmations:config.confirmations})
          }
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
      if(job.operation==='collect'){
        const snapshot=await readVault(job,rpc,{confirmations:config.confirmations})
        const end=await read(rpc,plan.vault,'endTime')
        if(!snapshot.isStarted||BigInt(snapshot.blockTimestamp)<=end)throw new ConfirmedFailure('Variable fees are available only after maturity.')
        await transact('collect-variable',plan.vault,encodeFunctionData({abi,functionName:'withdraw',args:[1n,'0x']}))
        await database.execution.saveObservation(job.intent_id,await readVault(job,rpc,{confirmations:config.confirmations}))
        await database.execution.setState(job.intent_id,owner,'created','collected')
        return {state:'collected',deploymentId:job.intent_id}
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
      // Finish reconciling earlier funding broadcasts even if somebody else
      // filled capacity meanwhile. Never abandon an unresolved signed spend.
      for (const previous of (await database.execution.transactions(job.intent_id)).filter(tx=>/^(reset|approve|fund)-premium-/.test(tx.step))) {
        if(await receiptFor(previous))continue
        await guard()
        const used=BigInt(await rpc('eth_getTransactionCount',[account.address,'latest']))
        if(used>BigInt(previous.nonce))throw new Waiting('Saved funding transaction outcome is unknown.')
        try{await rpc('eth_sendRawTransaction',[previous.raw_tx])}catch{}
        if(!await receiptFor(previous))throw new Waiting('Waiting for the saved funding transaction.')
      }
      // Premium funding is a distinct, separately approved job stage.
      const snapshot = await readVault(job, rpc, { confirmations: config.confirmations })
      if (BigInt(plan.premium) > BigInt(job.funding_max_raw ?? 0) || BigInt(plan.premium) > BigInt(config.maxPremiumRaw)) throw new ConfirmedFailure('Premium funding is not approved within budget.')
      const remaining = BigInt(snapshot.variableCapacity) - BigInt(snapshot.variableSupply)
      if (remaining > 0n && !snapshot.isStarted) {
        const asset = job.snapshot.variableAssetAddress
        const allowance = await read(rpc, asset, 'allowance', [account.address, plan.vault])
        if (allowance < remaining) {
          // Reset nonzero allowance for ERC-20s that require zero-before-change.
          if (allowance > 0n) await transact('reset-premium-' + job.funding_round, asset, encodeFunctionData({ abi, functionName: 'approve', args: [plan.vault,0n] }))
          await transact('approve-premium-' + job.funding_round, asset, encodeFunctionData({ abi, functionName: 'approve', args: [plan.vault,remaining] }))
        }
        const minimum = encodeAbiParameters([{type:'uint256'}],[remaining])
        await transact('fund-premium-' + job.funding_round, plan.vault, encodeFunctionData({ abi, functionName:'deposit',args:[remaining,1n,minimum] }))
      }
      const funded = await readVault(job, rpc, { confirmations: config.confirmations })
      if (!funded.isStarted && (BigInt(funded.variableSupply) !== BigInt(funded.variableCapacity) || BigInt(funded.variableBalance) < BigInt(funded.variableCapacity))) throw new ConfirmedFailure('Funding changed; fresh admin review is required.')
      await database.execution.saveObservation(job.intent_id, funded)
      await database.execution.setState(job.intent_id, owner, 'created', 'funded')
      return { state: 'funded', requestId: job.intent_id }
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
