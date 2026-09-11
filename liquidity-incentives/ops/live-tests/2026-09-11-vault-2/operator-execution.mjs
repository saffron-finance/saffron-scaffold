// Portable, import-only reference of the operator execution path.
// Host entry points and private actor IDs are intentionally excluded.
// Not imported by the paid watcher or any live CLI.
import { mkdir, open, readFile, rename, lstat, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { abi, CHAIN_ID, FACTORY, sameAddress } from '../../../shared/vault-lifecycle.mjs'
import { digest } from '../../../shared/incentives.mjs'
import { assertOneShotTransaction } from '../../../worker/one-shot.mjs'
import { readVault } from '../../../shared/vault-reader.mjs'
import { encodeFunctionData, decodeFunctionResult, decodeEventLog, keccak256 } from 'viem'
export const jsonSafe = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item))
const steps = ['create-adapter', 'create-vault', 'initialize-vault']

/** Only explicit guard diagnostics are safe for chat; third-party exceptions can
 * contain authenticated endpoints or signed bytes and must remain suppressed. */
export class GuardError extends Error {}
const demand = (condition, message) => { if (!condition) throw new GuardError(message) }

/** Atomically fsync an owner-only JSON journal before any broadcast. Signed raw
 * bytes are retained here for recovery and never included in public artifacts. */
export async function saveState(directory, state) {
  const file = join(directory, `state.${process.pid}.tmp`)
  const fd = await open(file, 'wx', 0o600)
  try { await fd.writeFile(JSON.stringify(jsonSafe(state), null, 2) + '\n'); await fd.sync() } finally { await fd.close() }
  await rename(file, join(directory, 'state.json'))
  const parent = await open(directory, 'r')
  try { await parent.sync() } finally { await parent.close() }
}

/** Validate the exact operator authority, not a fabricated payment-bound job.
 * Live LP sizing may differ from preview prices; premium/duration never change. */
export function validateInputs(job, config, simulation) {
  demand(config.enabled === true && config.chainId === CHAIN_ID, 'Explicit operator execution activation is required.')
  demand(job.intent_id === '79229eb4-970a-4248-ba37-307bcd5eb174' && job.operation === 'create' && job.resume_version === 0, 'Wrong operator request or operation.')
  demand(job.authorization?.kind === 'explicit-operator-one-off' && job.authorization.operatorApproved === true && job.authorization.nativeFeeVerified === false, 'Missing exact operator authorization.')
  demand(sameAddress(job.factory, FACTORY) && sameAddress(job.signer, config.signerAddress), 'Factory or signer mismatch.')
  demand(job.plan_hash === digest({ authorization: job.authorization, snapshot: job.snapshot, plan: job.plan, signer: job.signer }), 'Immutable operator terms changed.')
  demand(job.snapshot.chainId === CHAIN_ID && job.chain_id === CHAIN_ID && job.snapshot.fixedCapacityAmount === '10000'
    && job.snapshot.durationSeconds === 259200 && job.snapshot.feeTier === 10000
    && sameAddress(job.snapshot.poolAddress, '0xa70fc67c9f69da90b63a0e4c05d229954574e313')
    && sameAddress(job.snapshot.variableAssetAddress, '0x020bfc650a365f8bb26819deaabf3e21291018b4')
    && job.plan.premium === '499999999999999999727' && BigInt(job.plan.liquidity) > 0n
    && job.plan.minTick === -887200 && job.plan.maxTick === 887200, 'Exact authorized pool, capacity, premium or duration changed.')
  for (const field of ['factoryCodeHash', 'vaultTypeHash', 'adapterTypeHash']) demand(job.plan[field] === config[field], 'Reviewed bytecode policy changed.')
  demand(job.plan.vaultTypeId === '1' && job.plan.adapterTypeId === '2' && String(config.vaultTypeId) === '1' && String(config.adapterTypeId) === '2', 'Wrong registered contract type.')
  demand(Number.isInteger(config.confirmations) && config.confirmations >= 2, 'At least two confirmations are required.')
  demand(simulation?.ok && simulation.simulationOnly === true && simulation.upstreamBroadcasts === 0
    && simulation.chainId === CHAIN_ID && simulation.factoryCodeHash === config.factoryCodeHash
    && simulation.requestId === job.intent_id && simulation.planHash === job.plan_hash && sameAddress(simulation.signer, job.signer)
    && simulation.transactions?.length === 3 && simulation.transactions.every((tx, i) => tx.localOnly && tx.step === steps[i])
    && simulation.observation?.liquidity === job.plan.liquidity && simulation.observation?.variableCapacity === job.plan.premium
    && simulation.observation?.duration === 259200 && simulation.observation?.initialized === true
    && simulation.observation?.isStarted === false, 'Passing exact factory-fork simulation is required.')
  demand(BigInt(simulation.worstCaseGasWei) <= BigInt(config.maxDailyGasWei), 'Simulation exceeds total gas budget.')
}

/** Reconcile one saved hash with its exact mined transaction and canonical block.
 * No replacement signing is possible here. Null means pending, not failure. */
export async function canonicalReceipt(rpc, tx, signer, confirmations) {
  const receipt = await rpc('eth_getTransactionReceipt', [tx.hash])
  if (!receipt) return null
  const mined = await rpc('eth_getTransactionByHash', [tx.hash])
  const intended = tx.transaction_data
  demand(mined && sameAddress(mined.from, signer) && sameAddress(mined.to, intended.to)
    && mined.input.toLowerCase() === intended.data.toLowerCase() && BigInt(mined.value) === 0n
    && Number(BigInt(mined.nonce)) === tx.nonce && BigInt(mined.chainId) === BigInt(CHAIN_ID)
    && mined.hash.toLowerCase() === tx.hash.toLowerCase() && receipt.transactionHash.toLowerCase() === tx.hash.toLowerCase()
    && mined.blockHash === receipt.blockHash && mined.blockNumber === receipt.blockNumber, 'Mined transaction does not match the protected journal.')
  const block = await rpc('eth_getBlockByNumber', [receipt.blockNumber, false])
  demand(block?.hash === receipt.blockHash, 'Transaction receipt is not canonical; stop and reconcile.')
  if (BigInt(await rpc('eth_blockNumber')) < BigInt(receipt.blockNumber) + BigInt(confirmations - 1)) return null
  return receipt
}

/** Send only a previously fsynced transaction, once per invocation, and recover
 * a lost response by polling that same hash. Tests inject RPC and short timers. */
export async function sendSaved({ rpc, tx, signer, confirmations, persist, timeoutMs = 120000, pollMs = 1000 }) {
  let receipt = await canonicalReceipt(rpc, tx, signer, confirmations)
  if (!receipt) {
    // A mined transaction may only be waiting for its second confirmation.
    // Do not mistake that expected nonce advance for an unknown replacement.
    const unconfirmed = await rpc('eth_getTransactionReceipt', [tx.hash])
    if (!unconfirmed) {
      const used = BigInt(await rpc('eth_getTransactionCount', [signer, 'latest']))
      demand(used <= BigInt(tx.nonce), 'Nonce consumed without canonical receipt; saved hash requires reconciliation.')
      await persist() // Explicit durability callback precedes the send.
      try {
        const hash = await rpc('eth_sendRawTransaction', [tx.raw_tx])
        demand(hash.toLowerCase() === tx.hash.toLowerCase(), 'Broadcast returned a different hash.')
      } catch (error) { if (error instanceof GuardError) throw error }
    }
    const end = Date.now() + timeoutMs
    while (!receipt && Date.now() < end) {
      await delay(pollMs)
      receipt = await canonicalReceipt(rpc, tx, signer, confirmations)
    }
  }
  demand(receipt, 'Saved transaction remains unresolved; no replacement or additional vault is authorized.')
  tx.receipt = receipt
  await persist()
  demand(receipt.status === '0x1', 'A transaction reverted; the one-off attempt is terminal.')
  return receipt
}

/** Exactly one operator-authorized vault with durable recovery. This standalone
 * operator path does not alter the normal paid watcher, database, or browser.
 * The permanent existing signer permit prevents later reuse for a second vault. */
export async function executeOne({ job: inputJob, config, simulation, rpc, account, onProgress = () => {} }) {
  validateInputs(inputJob, config, simulation)
  demand(sameAddress(account.address, inputJob.signer), 'Protected signer identity does not match.')
  const directory = config.stateDirectory
  await mkdir(directory, { recursive: true, mode: 0o700 })
  const info = await lstat(directory)
  demand(info.isDirectory() && !(info.mode & 0o077), 'Private state directory permissions are required.')
  const lock = join(directory, 'execution.lock')
  await mkdir(lock, { mode: 0o700 })
  try {
    const identity = { mode: 'explicit-operator-one-off', requestId: inputJob.intent_id, signer: inputJob.signer,
      planHash: inputJob.plan_hash, chainId: CHAIN_ID, factory: FACTORY, simulationHash: digest(simulation), policyHash: digest(config) }
    let state
    try {
      const meta = await lstat(join(directory, 'state.json'))
      demand(meta.isFile() && !(meta.mode & 0o077), 'Private journal permissions are required.')
      state = JSON.parse(await readFile(join(directory, 'state.json'), 'utf8'))
    } catch (error) { if (error.code !== 'ENOENT') throw error }
    if (state) {
      demand(digest(state.identity) === digest(identity), 'Permanent signer permit is bound to a different request or policy.')
      if (state.status === 'completed') return state.result
      demand(state.status === 'armed' && !state.journal.some(tx => tx.receipt?.status === '0x0'), 'Previous one-off attempt is terminal.')
    } else {
      const age = Date.now() - Date.parse(simulation.checkedAt)
      demand(age >= -5000 && age <= 600000, 'The passing simulation must be less than ten minutes old.')
      const fork = await rpc('eth_getBlockByNumber', ['0x' + BigInt(simulation.forkBlockNumber).toString(16), false])
      demand(fork?.hash === simulation.forkBlockHash, 'Simulation fork block is no longer canonical.')
      const latest = BigInt(await rpc('eth_getTransactionCount', [account.address, 'latest']))
      const pending = BigInt(await rpc('eth_getTransactionCount', [account.address, 'pending']))
      demand(latest === pending && latest <= BigInt(Number.MAX_SAFE_INTEGER), 'Signer nonce is not ready for an isolated attempt.')
      demand(BigInt(await rpc('eth_getBalance', [account.address, 'latest'])) >= BigInt(config.maxDailyGasWei), 'Signer does not cover the complete gas budget.')
      state = { identity, status: 'armed', initialNonce: Number(latest), maxGasWei: config.maxDailyGasWei,
        armedAt: new Date().toISOString(), journal: [], resolvedPlan: {} }
      await saveState(directory, state)
    }
    const job = structuredClone(inputJob)
    Object.assign(job.plan, state.resolvedPlan)
    const plan = job.plan
    const persist = () => saveState(directory, state)
    const read = async (address, name, args = [], tag = 'latest') => decodeFunctionResult({ abi, functionName: name,
      data: await rpc('eth_call', [{ to: address, data: encodeFunctionData({ abi, functionName: name, args }) }, tag]) })
    const permit = { ...identity, initialNonce: state.initialNonce, maxGasWei: state.maxGasWei }

    /** Pin fresh code/fee/head and all previous receipts before each signature. */
    async function beforeNewSignature() {
      demand(BigInt(await rpc('eth_chainId')) === BigInt(CHAIN_ID), 'Wrong live chain.')
      const head = await rpc('eth_getBlockByNumber', ['latest', false])
      const age = Date.now() - Number(BigInt(head.timestamp)) * 1000
      demand(age >= -5000 && age < 60000, 'Fresh canonical chain head is required.')
      const code = await rpc('eth_getCode', [FACTORY, head.number])
      const vault = await read(FACTORY, 'vaultTypeByteCode', [1n], head.number)
      const adapter = await read(FACTORY, 'adapterTypeByteCode', [2n], head.number)
      demand(keccak256(code) === config.factoryCodeHash && keccak256(vault) === config.vaultTypeHash
        && keccak256(adapter) === config.adapterTypeHash, 'Factory or registered type changed.')
      demand((await read(FACTORY, 'feeBps', [], head.number)).toString() === plan.feeBps, 'Factory protocol fee changed.')
      for (const prior of state.journal) {
        const receipt = await canonicalReceipt(rpc, prior, account.address, config.confirmations)
        demand(receipt?.status === '0x1' && receipt.blockHash === prior.receipt?.blockHash, 'Prior transaction changed; stop for reconciliation.')
      }
      const expected = state.initialNonce + state.journal.length
      for (const tag of ['latest', 'pending']) demand(Number(BigInt(await rpc('eth_getTransactionCount', [account.address, tag]))) === expected, 'Signer nonce changed outside this one-off deployment.')
      return head
    }

    /** Sign at most once per step; raw bytes enter the protected journal first. */
    async function transact(index, name, args, eventName) {
      const data = encodeFunctionData({ abi, functionName: name, args })
      let tx = state.journal[index]
      if (!tx) {
        demand(index === state.journal.length, 'Execution journal is out of order.')
        const feeHead = await beforeNewSignature()
        // This chain's suggested legacy fee can equal its base fee exactly.
        // Add one base-fee worth of headroom before a NEW signature; existing
        // saved transactions remain byte-identical and are never fee-replaced.
        const gasPrice = BigInt(await rpc('eth_gasPrice')) + BigInt(feeHead.baseFeePerGas ?? '0x0')
        const gas = (BigInt(await rpc('eth_estimateGas', [{ from: account.address, to: FACTORY, data, value: '0x0' }])) * 120n + 99n) / 100n
        demand(gas > 0n && gas <= BigInt(config.maxGasPerTx) && gasPrice > 0n && gasPrice <= BigInt(config.maxGasPriceWei), 'Transaction exceeds gas policy.')
        const transaction = { chainId: CHAIN_ID, type: 'legacy', nonce: state.initialNonce + index, to: FACTORY, data, value: 0n, gas, gasPrice }
        assertOneShotTransaction({ permit, job, step: steps[index], transaction, journal: state.journal })
        const remaining = BigInt(state.maxGasWei) - state.journal.reduce((n, prior) => n + BigInt(prior.transaction_data.gas) * BigInt(prior.transaction_data.gasPrice), 0n)
        demand(BigInt(await rpc('eth_getBalance', [account.address, 'latest'])) >= remaining, 'Remaining signer gas coverage is insufficient.')
        const raw = await account.signTransaction(transaction)
        tx = { step: steps[index], resume_version: 0, nonce: transaction.nonce, hash: keccak256(raw), raw_tx: raw, transaction_data: jsonSafe(transaction) }
        state.journal.push(tx)
        await persist()
        onProgress({ state: 'signed-and-journaled', step: tx.step, hash: tx.hash, nonce: tx.nonce })
      } else demand(tx.transaction_data.data === data && tx.step === steps[index], 'Saved transaction calldata changed.')
      const receipt = await sendSaved({ rpc, tx, signer: account.address, confirmations: config.confirmations, persist })
      onProgress({ state: 'confirmed', step: tx.step, hash: tx.hash, blockNumber: Number(BigInt(receipt.blockNumber)) })
      if (!eventName) return
      const events = receipt.logs.filter(log => sameAddress(log.address, FACTORY) && !log.removed).flatMap(log => {
        try { const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics }); return decoded.eventName === eventName ? [decoded.args] : [] } catch { return [] }
      })
      demand(events.length === 1 && sameAddress(events[0].creator, account.address), 'Factory event creator mismatch.')
      return events[0]
    }
    const adapter = await transact(0, 'createAdapter', [2n, job.snapshot.poolAddress, '0x'], 'AdapterCreated')
    demand(sameAddress(adapter.pool, job.snapshot.poolAddress) && adapter.adapterTypeId === 2n, 'Created adapter terms mismatch.')
    Object.assign(state.resolvedPlan, { adapter: adapter.adapter.toLowerCase(), adapterId: adapter.id.toString(), adapterCodeHash: keccak256(await rpc('eth_getCode', [adapter.adapter, 'latest'])) })
    Object.assign(plan, state.resolvedPlan); await persist()
    const vault = await transact(1, 'createVault', [1n, plan.adapter], 'VaultCreated')
    demand(sameAddress(vault.adapter, plan.adapter) && vault.vaultTypeId === 1n, 'Created vault terms mismatch.')
    Object.assign(state.resolvedPlan, { vault: vault.vault.toLowerCase(), vaultId: vault.vaultId.toString(), vaultCodeHash: keccak256(await rpc('eth_getCode', [vault.vault, 'latest'])) })
    Object.assign(plan, state.resolvedPlan); await persist()
    await transact(2, 'initializeVault', [BigInt(plan.vaultId), BigInt(plan.liquidity), BigInt(plan.premium), 259200n, job.snapshot.variableAssetAddress, BigInt(plan.feeBps)])
    const observation = await readVault(job, rpc, { confirmations: config.confirmations })
    demand(observation.claimSupply === '0' && observation.variableSupply === '0' && observation.variableBalance === '0' && !observation.isStarted, 'Unexpected funding or LP state; no additional action authorized.')
    const transactions = state.journal.map(({ step, hash, nonce, receipt }) => ({ step, hash, nonce, receipt }))
    const gasPaidWei = transactions.reduce((n, tx) => n + BigInt(tx.receipt.gasUsed) * BigInt(tx.receipt.effectiveGasPrice), 0n).toString()
    const result = { state: 'created', requestId: job.intent_id, chainId: CHAIN_ID, factory: FACTORY, signer: account.address,
      vault: plan.vault, vaultId: plan.vaultId, adapter: plan.adapter, plan, observation, transactions, gasPaidWei,
      authorization: job.authorization, checkedAt: new Date().toISOString(), userWalletAssigned: false }
    state.status = 'completed'; state.result = result; state.completedAt = result.checkedAt
    await persist()
    return result
  } finally { await rmdir(lock) }
}
