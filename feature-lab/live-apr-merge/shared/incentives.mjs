import { keccak256, stringToHex } from 'viem'
import { campaignTerms, campaignRate } from './campaign.mjs'

export const CHAIN_ID = 4663
export const FACTORY = '0xce97ee64ad415976c465a783725014e67832be1a'
export const UINT256_MAX = (1n << 256n) - 1n
export const validAddress = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value) && !/^0x0{40}$/i.test(value)
export const validId = value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]{0,79}$/.test(value)
export const fault = (status, message) => Object.assign(new Error(message), { status })
export const jsonSafe = value => JSON.parse(JSON.stringify(value, (_, item) => typeof item === 'bigint' ? item.toString() : item))
export function integer(value, { positive = false } = {}) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) > UINT256_MAX || (positive && value === '0')) throw fault(400, 'Use an exact, bounded integer amount.')
  return value
}
export function cents(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,11})(\.[0-9]{1,2})?$/.test(value)) throw fault(400, 'Enter a positive USD amount with at most two decimal places.')
  const [whole, fraction = ''] = value.split('.')
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))
  if (result <= 0n) throw fault(400, 'Enter a positive USD amount.')
  return result.toString()
}
/** Convert an operator's ETH decimal to exact wei. Never round excess precision
 * or use floating point: this amount becomes immutable wallet payment terms. */
export function requestFeeFromEth(value) {
  if(typeof value!=='string'||!/^(0|[1-9][0-9]*)(\.[0-9]{1,18})?$/.test(value))throw fault(400,'Enter a positive ETH request fee with at most 18 decimal places.')
  const [whole,fraction='']=value.split('.')
  return integer((BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0'))).toString(),{positive:true})
}
function revision(value) { if (!Number.isSafeInteger(value) || value < 0) throw fault(400, 'Invalid revision.'); return value }
function id(value) { if (!validId(value)) throw fault(400, 'Use a lowercase identifier with letters, numbers, and hyphens.'); return value }
function address(value) { if (!validAddress(value)) throw fault(400, 'Invalid token, wallet, or pool address.'); return value.toLowerCase() }
function token(value) {
  if (!value || !/^[A-Za-z0-9._-]{1,20}$/.test(value.symbol) || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 18) throw fault(400, 'Invalid token metadata.')
  return { address: address(value.address), symbol: value.symbol, decimals: value.decimals }
}
function flag(value) { if (typeof value !== 'boolean') throw fault(400, 'Invalid active/paused flag.'); return value }
export function normalizePair(value) {
  if (!value || value.chainId !== CHAIN_ID || ![100,500,3000,10000].includes(value.feeTier)) throw fault(400, 'Choose a supported Robinhood pool.')
  const result = { id: id(value.id), revision: revision(value.revision), chainId: CHAIN_ID, pool: address(value.pool), feeTier: value.feeTier,
    token0: token(value.token0), token1: token(value.token1), active: flag(value.active) }
  if (result.token0.address === result.token1.address) throw fault(400, 'Choose two different tokens.')
  return result
}
export function normalizeProgram(value) {
  if (!value || !Number.isFinite(value.apr) || value.apr < .01 || value.apr > 100000 || Number(value.apr.toFixed(2)) !== value.apr
    || !Number.isInteger(value.days) || value.days < 1 || value.days > 3650 || !Number.isInteger(value.sortOrder) || Math.abs(value.sortOrder) > 100000) throw fault(400, 'Check the APR, duration, and ordering.')
  const minimumCents='1',maximumCents=UINT256_MAX.toString()
  return { id: id(value.id), revision: revision(value.revision), pairId: id(value.pairId), budgetPoolId: id(value.budgetPoolId), apr: value.apr,
    days: value.days, requestFeeWei:integer(value.requestFeeWei,{positive:true}), minimumCents, maximumCents, sortOrder: value.sortOrder, isNew: flag(value.isNew), active: flag(value.active) }
}
export function normalizeBudget(value) {
  if (!value || value.chainId !== CHAIN_ID || !Number.isInteger(value.decimals) || value.decimals < 0 || value.decimals > 18
    || typeof value.name !== 'string' || value.name.trim().length < 1 || value.name.length > 100 || /[\r\n]/.test(value.name)) throw fault(400, 'Check the campaign budget fields.')
  let campaign=null
  if(value.campaign){try{campaign=campaignTerms({...value.campaign.inputs,days:value.campaign.days})}catch(error){throw fault(400,error.message)}}
  return { campaign, id: id(value.id), revision: revision(value.revision), name: value.name.trim(), chainId: CHAIN_ID,
    rewardAsset: address(value.rewardAsset), decimals: value.decimals, limitRaw: integer(value.limitRaw), paused: flag(value.paused) }
}
// Stable canonical hashing is shared by the API, wallet review, and execution journal.
export function digest(value) {
  const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])]))
    : typeof value === 'bigint' ? value.toString() : value
  return keccak256(stringToHex(JSON.stringify(canonical(value))))
}
export function walletSessionMessage(proof) {
  return ['Saffron Liquidity Incentives: sign in', 'This session does not authorize deployment or token transfers.',
    `Origin: ${proof.origin}`, `Wallet: ${proof.wallet}`, `Chain: ${CHAIN_ID}`, `Nonce: ${proof.nonce}`, `Expires: ${proof.expiresAt}`].join('\n')
}
export function snapshotFor(offer, principalCents, wallet) {
  return { chainId: CHAIN_ID, submitterAddress: address(wallet), poolAddress: offer.pool, feeTier: offer.feeTier,
    token0: offer.token0, token1: offer.token1, token0Address: offer.token0.address, token1Address: offer.token1.address,
    fixedCapacityAmount: principalCents, durationSeconds: (offer.budget?.campaign?.days??offer.days) * 86400, targetApr: offer.apr / 100,
    aprRaw: offer.budget?.campaign?.aprRaw??(BigInt(Math.round(offer.apr * 100)) * 10n ** 14n).toString(), variableAssetAddress: offer.token0.address,
    campaign:offer.budget?.campaign?campaignRate(offer.budget.campaign):null, adapterType: 'fullRange', programId: offer.id, pairId: offer.pairId, display: { pair: `${offer.token0.symbol} / ${offer.token1.symbol}` } }
}
