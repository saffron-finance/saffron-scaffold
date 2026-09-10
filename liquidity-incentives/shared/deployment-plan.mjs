import { decodeFunctionResult, encodeFunctionData, keccak256 } from 'viem'
import { abi, CHAIN_ID, FACTORY, sameAddress } from './vault-lifecycle.mjs'
import { resolveCapacities } from './liquidity-math.mjs'
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
    aprRaw: BigInt(t.aprRaw), duration: t.durationSeconds,
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

