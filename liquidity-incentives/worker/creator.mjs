import { randomUUID } from 'node:crypto'
import { decodeEventLog, decodeFunctionResult, encodeAbiParameters, encodeFunctionData, keccak256, parseUnits } from 'viem'
import { abi, CHAIN_ID, FACTORY, sameAddress, termsDigest } from '../shared/vault-lifecycle.mjs'
import { readVault } from '../shared/vault-reader.mjs'
import { resolveCapacities } from '../shared/liquidity-math.mjs'

const jsonSafe = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item))
class Waiting extends Error {}
class ConfirmedFailure extends Error {}
const read = async (rpc, address, functionName, args = [], block = 'latest') =>
  decodeFunctionResult({ abi, functionName, data: await rpc('eth_call', [{ to: address,
    data: encodeFunctionData({ abi, functionName, args }) }, block]) })

/** Freeze the reviewed USD/APR intent into contract units against one live pool
 * block and a fresh quote-token USD observation. Subsequent retries keep it.
 */
export async function resolvePlan(job, rpc, usdQuote, config) {
  if (BigInt(await rpc('eth_chainId', [])) !== BigInt(CHAIN_ID)) throw new ConfirmedFailure('Wrong deployer chain.')
  const head = await rpc('eth_getBlockByNumber', ['latest', false])
  if (Date.now() - Number(BigInt(head.timestamp)) * 1000 > 60_000) throw new Waiting('Chain head is stale.')
  const t = job.snapshot, tag = head.number
  const [factoryCode, vaultType, adapterType, token0, token1, decimals0, decimals1, spacing, fee, slot, feeBps] = await Promise.all([
    rpc('eth_getCode', [FACTORY, tag]), read(rpc, FACTORY, 'vaultTypeByteCode', [BigInt(config.vaultTypeId)], tag),
    read(rpc, FACTORY, 'adapterTypeByteCode', [BigInt(config.adapterTypeId)], tag),
    read(rpc, t.poolAddress, 'token0', [], tag), read(rpc, t.poolAddress, 'token1', [], tag),
    read(rpc, t.token0.address, 'decimals', [], tag), read(rpc, t.token1.address, 'decimals', [], tag),
    read(rpc, t.poolAddress, 'tickSpacing', [], tag), read(rpc, t.poolAddress, 'fee', [], tag),
    read(rpc, t.poolAddress, 'slot0', [], tag), read(rpc, FACTORY, 'feeBps', [], tag),
  ])
  if (factoryCode === '0x' || vaultType === '0x' || adapterType === '0x'
    || keccak256(factoryCode) !== config.factoryCodeHash || keccak256(vaultType) !== config.vaultTypeHash
    || keccak256(adapterType) !== config.adapterTypeHash) throw new ConfirmedFailure('Factory/type hashes need operator review.')
  if (!sameAddress(t.variableAssetAddress, t.token0.address)
    || ![token0, token1].every(token => [t.token0.address,t.token1.address].some(value => sameAddress(token,value)))
    || Number(decimals0) !== t.token0.decimals || Number(decimals1) !== t.token1.decimals
    || Number(fee) !== t.feeTier || Number(spacing) <= 0) throw new ConfirmedFailure('Pool or token metadata changed.')
  const sorted0 = sameAddress(token0,t.token0.address) ? t.token0 : t.token1
  const sorted1 = sameAddress(token1,t.token1.address) ? t.token1 : t.token0
  const quote = await usdQuote(t.token1.address)
  if (!quote?.priceRaw || !Number.isFinite(quote.checkedAt) || Date.now() - quote.checkedAt > 60_000 || quote.checkedAt > Date.now() + 5000) throw new Waiting('Fresh USD pricing unavailable.')
  const p = slot[0], square = p * p, q192 = 1n << 192n
  const quotePrice = BigInt(quote.priceRaw)
  const price0 = sameAddress(token1, t.token1.address)
    ? quotePrice * square * 10n ** BigInt(sorted0.decimals) / (q192 * 10n ** BigInt(sorted1.decimals)) : quotePrice
  const price1 = sameAddress(token1,t.token1.address)
    ? quotePrice : quotePrice * q192 * 10n ** BigInt(sorted1.decimals) / (square * 10n ** BigInt(sorted0.decimals))
  const variablePrice = sameAddress(token0,t.variableAssetAddress) ? price0 : price1
  const minTick = Math.ceil(-887272 / Number(spacing)) * Number(spacing), maxTick = -minTick
  const capacities = resolveCapacities({ cents: t.fixedCapacityAmount,
    aprRaw: parseUnits(String(t.targetApr), 18), duration: t.durationSeconds,
    price0, price1, variablePrice, decimals0: sorted0.decimals, decimals1: sorted1.decimals,
    variableDecimals: t.token0.decimals, sqrtPrice: p, minTick, maxTick })
  if (BigInt(capacities.premium) > BigInt(config.maxPremiumRaw)) throw new ConfirmedFailure('Premium exceeds the configured operator budget.')
  if ((await rpc('eth_getBlockByNumber',[tag,false]))?.hash !== head.hash) throw new Waiting('Sizing block changed.')
  return { ...capacities, token0: { ...sorted0, address: token0.toLowerCase() }, token1: { ...sorted1, address: token1.toLowerCase() },
    minTick, maxTick, variableDecimals: t.token0.decimals, variableSymbol: t.token0.symbol,
    vaultTypeId: String(config.vaultTypeId), adapterTypeId: String(config.adapterTypeId),
    feeBps: feeBps.toString(), factoryCodeHash: config.factoryCodeHash,
    vaultTypeHash: config.vaultTypeHash, adapterTypeHash: config.adapterTypeHash,
    price0: price0.toString(), price1: price1.toString(), variablePrice: variablePrice.toString(),
    sizingBlock: head.number, sizingBlockHash: head.hash, usdCheckedAt: quote.checkedAt }
}

/** Execute at most one leased job; durable signed bytes precede every broadcast.
 * The injected account lives only in this worker, never the HTTP process.
 */
export function createCreator({ database, rpc, account, config, usdQuote }) {
  const owner = randomUUID()
  async function tick() {
    await database.lifecycle.heartbeat(account.address)
    const lock = await database.lifecycle.signerLock(account.address)
    if (!lock) return { state: 'locked' }
    let job
    try {
      job = await database.lifecycle.claim(account.address, owner)
      if (!job) return { state: 'idle' }
      if (!sameAddress(job.signer, account.address) || !sameAddress(job.factory, FACTORY) || job.chain_id !== CHAIN_ID) throw new ConfirmedFailure('Job signer, factory or chain mismatch.')
      if (BigInt(await rpc('eth_chainId', [])) !== BigInt(CHAIN_ID)) throw new ConfirmedFailure('Wrong deployer chain.')
      const [current] = await database.list({ requestId: job.request_id })
      if (!current || termsDigest(current) !== job.approved_digest || ['rejected'].includes(current.status)) throw new ConfirmedFailure('Approved request changed.')
      if (!job.plan) {
        job.plan = await resolvePlan(job, rpc, usdQuote, config)
        await database.lifecycle.setPlan(job.request_id, owner, job.plan)
      }
      const plan = job.plan
      async function guard() { await lock.assert(); await database.lifecycle.renew(job.request_id, owner) }
      async function savePlan() { await database.lifecycle.setPlan(job.request_id, owner, plan) }
      async function receiptFor(tx) {
        const receipt = await rpc('eth_getTransactionReceipt', [tx.hash])
        if (!receipt) return null
        const mined = await rpc('eth_getTransactionByHash', [tx.hash])
        const intended = tx.transaction_data
        if (receipt.transactionHash?.toLowerCase() !== tx.hash.toLowerCase() || !mined || !sameAddress(mined.from, account.address) || !sameAddress(mined.to, intended.to) || mined.input !== intended.data || BigInt(mined.value) !== BigInt(intended.value) || BigInt(mined.nonce) !== BigInt(tx.nonce)) throw new Waiting('Transaction evidence does not match the saved action.')
        const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
        const head = BigInt(await rpc('eth_blockNumber', []))
        if (block?.hash !== receipt.blockHash || head < BigInt(receipt.blockNumber) + BigInt(config.confirmations - 1)) throw new Waiting('Waiting for canonical transaction confirmations.')
        await database.lifecycle.saveReceipt(tx.hash, receipt)
        return receipt
      }
      async function transact(step, to, data) {
        await guard()
        let tx = await database.lifecycle.lastTransaction(job.request_id, step)
        if (tx) {
          const receipt = await receiptFor(tx)
          if (receipt?.status === '0x1') return receipt
          if (receipt?.status === '0x0') {
            if (tx.resume_version >= job.resume_version) throw new ConfirmedFailure('Transaction reverted. Inspect and approve Resume.')
            tx = null // A new nonce is allowed only after explicit resume of a proven revert.
          }
        }
        if (!tx) {
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
          await database.lifecycle.saveTransaction({ requestId: job.request_id, step, resumeVersion: job.resume_version,
            signer: from, nonce, hash, raw, transaction: jsonSafe(transaction) })
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
      if (job.state !== 'created') {
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
        await database.lifecycle.markCreated(job.request_id, owner, snapshot)
        return { state: 'created', requestId: job.request_id }
      }
      // Finish reconciling earlier funding broadcasts even if somebody else
      // filled capacity meanwhile. Never abandon an unresolved signed spend.
      for (const prefix of ['reset-premium-', 'approve-premium-', 'fund-premium-']) {
        const previous = await database.lifecycle.lastTransaction(job.request_id, prefix + job.resume_version)
        if (previous) await transact(previous.step, previous.transaction_data.to, previous.transaction_data.data)
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
          if (allowance > 0n) await transact('reset-premium-' + job.resume_version, asset, encodeFunctionData({ abi, functionName: 'approve', args: [plan.vault,0n] }))
          await transact('approve-premium-' + job.resume_version, asset, encodeFunctionData({ abi, functionName: 'approve', args: [plan.vault,remaining] }))
        }
        const minimum = encodeAbiParameters([{type:'uint256'}],[remaining])
        await transact('fund-premium-' + job.resume_version, plan.vault, encodeFunctionData({ abi, functionName:'deposit',args:[remaining,1n,minimum] }))
      }
      const funded = await readVault(job, rpc, { confirmations: config.confirmations })
      if (BigInt(funded.variableSupply) !== BigInt(funded.variableCapacity) || BigInt(funded.variableBalance) < BigInt(funded.variableCapacity)) throw new ConfirmedFailure('Funding changed; fresh admin review is required.')
      await database.lifecycle.saveObservation(job.request_id, funded)
      await database.lifecycle.setState(job.request_id, owner, 'created', 'funded')
      return { state: 'funded', requestId: job.request_id }
    } catch (error) {
      if (job) {
        const waiting = error instanceof Waiting || !(error instanceof ConfirmedFailure)
        const reason = error instanceof Waiting || error instanceof ConfirmedFailure ? error.message : 'Worker/RPC unavailable; all saved transactions retained.'
        await database.lifecycle.setState(job.request_id, owner, job.state === 'created' ? 'created' : waiting ? 'waiting' : 'failed',
          job.state === 'created' ? waiting ? 'waiting' : 'failed' : job.funding_state, reason)
        return { state: waiting ? 'waiting' : 'failed', requestId: job.request_id, reason }
      }
      throw error
    } finally { await lock.release() }
  }
  return { tick }
}
