import { decodeFunctionResult, encodeFunctionData, keccak256 } from 'viem'
import { abi, CHAIN_ID, FACTORY, sameAddress, MAX_HEAD_AGE } from './vault-lifecycle.mjs'

/** Read adapter/vault/funding state at one block; recheck its hash after calls.
 * This module has no signing or sending methods and is shared with browser reads.
 */
export async function readVault(job, rpc, { confirmations = 2, now = Date.now } = {}) {
  const plan = job.plan
  if (!plan?.vault || !plan.adapter || !Number.isInteger(confirmations) || confirmations < 1) throw new Error('Vault not resolved')
  if (BigInt(await rpc('eth_chainId', [])) !== BigInt(CHAIN_ID)) throw new Error('Wrong chain')
  const head = await rpc('eth_getBlockByNumber', ['latest', false])
  if (!head?.hash || now() - Number(BigInt(head.timestamp)) * 1000 > MAX_HEAD_AGE) throw new Error('Chain head is stale')
  const height = BigInt(head.number) - BigInt(confirmations - 1)
  if (height < 0n) throw new Error('Confirmations unavailable')
  const tag = '0x' + height.toString(16)
  const block = await rpc('eth_getBlockByNumber', [tag, false])
  if (!block?.hash) throw new Error('Block unavailable')
  const read = async (address, name, args = []) => decodeFunctionResult({ abi, functionName: name,
    data: await rpc('eth_call', [{ to: address, data: encodeFunctionData({ abi, functionName: name, args }) }, tag]) })
  const [factory, adapter, initialized, started, fixed, capacity, asset, duration, fee, bearer, claim, vaultId,
    pool, minTick, maxTick, attached, adapterFactory, factoryCode, vaultCode, adapterCode, adapterId, adapterRegistration] = await Promise.all([
    read(plan.vault, 'factory'), read(plan.vault, 'adapter'), read(plan.vault, 'initialized'),
    read(plan.vault, 'isStarted'), read(plan.vault, 'fixedSideCapacity'), read(plan.vault, 'variableSideCapacity'),
    read(plan.vault, 'variableAsset'), read(plan.vault, 'duration'), read(plan.vault, 'feeBps'),
    read(plan.vault, 'variableBearerToken'), read(plan.vault, 'claimToken'), read(plan.vault, 'vaultId'),
    read(plan.adapter, 'pool'), read(plan.adapter, 'poolMinTick'), read(plan.adapter, 'poolMaxTick'),
    read(plan.adapter, 'vaultAddress'), read(plan.adapter, 'factoryAddress'),
    rpc('eth_getCode', [FACTORY, tag]), rpc('eth_getCode', [plan.vault, tag]), rpc('eth_getCode', [plan.adapter, tag]),
    read(FACTORY, 'deployedAdapterAddrToId', [plan.adapter]), read(FACTORY, 'deployedAdapterInfo', [BigInt(plan.adapterId)]),
  ])
  if (!initialized) throw new Error('Vault is not initialized')
  const [registration, registeredId, claimSupply, supply, balance, decimals, token0, token1, poolFee, slot0] = await Promise.all([
    read(FACTORY, 'vaultInfo', [vaultId]), read(FACTORY, 'vaultAddrToId', [plan.vault]),
    read(claim, 'totalSupply'), read(bearer, 'totalSupply'), read(asset, 'balanceOf', [plan.vault]),
    read(asset, 'decimals'), read(pool, 'token0'), read(pool, 'token1'), read(pool, 'fee'), read(pool, 'slot0'),
  ])
  const valid = sameAddress(factory, FACTORY) && sameAddress(adapterFactory, FACTORY)
    && adapterId.toString() === plan.adapterId && adapterRegistration[0].toString() === plan.adapterTypeId
    && sameAddress(adapterRegistration[1], job.signer) && sameAddress(adapterRegistration[2], plan.adapter)
    && adapterCode !== '0x' && keccak256(adapterCode) === plan.adapterCodeHash
    && sameAddress(adapter, plan.adapter) && sameAddress(attached, plan.vault)
    && sameAddress(pool, job.snapshot.poolAddress) && sameAddress(asset, job.snapshot.variableAssetAddress)
    && sameAddress(token0, plan.token0.address) && sameAddress(token1, plan.token1.address)
    && sameAddress(registration[0], job.signer) && sameAddress(registration[1], plan.vault)
    && sameAddress(registration[2], plan.adapter) && registration[3].toString() === plan.vaultTypeId
    && registeredId === vaultId && vaultId.toString() === plan.vaultId
    && fixed.toString() === plan.liquidity && capacity.toString() === plan.premium
    && duration.toString() === String(job.snapshot.durationSeconds) && fee.toString() === plan.feeBps
    && Number(minTick) === plan.minTick && Number(maxTick) === plan.maxTick
    && Number(decimals) === plan.variableDecimals && Number(poolFee) === job.snapshot.feeTier
    && factoryCode !== '0x' && keccak256(factoryCode) === plan.factoryCodeHash
    && vaultCode !== '0x' && keccak256(vaultCode) === plan.vaultCodeHash
  if (!valid) throw new Error('Vault does not match approved terms')
  const canonical = await rpc('eth_getBlockByNumber', [tag, false])
  if (canonical?.hash !== block.hash) throw new Error('Observation block changed')
  return {
    verified: true, canonical: true, chainId: CHAIN_ID, factory: FACTORY, vault: plan.vault, adapter: plan.adapter,
    initialized: Boolean(initialized), isStarted: Boolean(started), claimSupply: claimSupply.toString(),
    variableCapacity: capacity.toString(), variableSupply: supply.toString(), variableBalance: balance.toString(),
    variableAsset: asset, variableDecimals: Number(decimals), variableSymbol: plan.variableSymbol,
    token0: plan.token0, token1: plan.token1, liquidity: fixed.toString(), minTick: Number(minTick), maxTick: Number(maxTick),
    sqrtPrice: slot0[0].toString(), duration: Number(duration), blockNumber: height.toString(), blockHash: block.hash,
    blockTimestamp: Number(BigInt(block.timestamp)), headTimestamp: Number(BigInt(head.timestamp)),
    checkedAt: now(),
  }
}
