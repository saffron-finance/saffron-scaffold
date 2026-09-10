import { keccak256, stringToHex, parseAbi } from 'viem'
import { validAddress } from './vault-request.mjs'

export const CHAIN_ID = 4663
export const FACTORY = '0xce97ee64ad415976c465a783725014e67832be1a'
export const WETH = '0x0bd7d308f8e1639fab988df18a8011f41eacad73'
export const MAX_OBSERVATION_AGE = 15_000
export const MAX_HEAD_AGE = 60_000
export const POLL_MS = 5000
export const abi = parseAbi([
  'function initialized() view returns (bool)', 'function factory() view returns (address)',
  'function adapter() view returns (address)', 'function vaultId() view returns (uint256)',
  'function duration() view returns (uint256)', 'function isStarted() view returns (bool)',
  'function fixedSideCapacity() view returns (uint256)', 'function variableSideCapacity() view returns (uint256)',
  'function variableAsset() view returns (address)', 'function variableBearerToken() view returns (address)',
  'function claimToken() view returns (address)', 'function totalSupply() view returns (uint256)',
  'function fixedBearerToken() view returns (address)', 'function endTime() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)', 'function allowance(address,address) view returns (uint256)',
  'function approve(address,uint256) returns (bool)', 'function decimals() view returns (uint8)',
  'function deposit(uint256,uint256,bytes)', 'function claim()', 'function deposit() payable',
  'function withdraw(uint256,bytes)',
  'function pool() view returns (address)', 'function poolMinTick() view returns (int24)',
  'function poolMaxTick() view returns (int24)', 'function vaultAddress() view returns (address)',
  'function factoryAddress() view returns (address)', 'function token0() view returns (address)',
  'function token1() view returns (address)', 'function fee() view returns (uint24)',
  'function tickSpacing() view returns (int24)',
  'function slot0() view returns (uint160,int24,uint16,uint16,uint16,uint8,bool)',
  'function vaultAddrToId(address) view returns (uint256)',
  'function vaultInfo(uint256) view returns (address creatorAddress,address addr,address adapterAddress,uint256 vaultTypeId)',
  'function deployedAdapterAddrToId(address) view returns (uint256)',
  'function deployedAdapterInfo(uint256) view returns (uint256 adapterTypeId,address creatorAddress,address addr)',
  'function vaultTypeByteCode(uint256) view returns (bytes)',
  'function adapterTypeByteCode(uint256) view returns (bytes)',
  'function feeBps() view returns (uint256)',
  'function createAdapter(uint256,address,bytes)', 'function createVault(uint256,address)',
  'function initializeVault(uint256,uint256,uint256,uint256,address,uint256)',
  'event AdapterCreated(uint256 id,uint256 indexed adapterTypeId,address pool,address indexed creator,address indexed adapter)',
  'event VaultCreated(uint256 vaultId,uint256 indexed vaultTypeId,address adapter,address indexed creator,address indexed vault)',
  'event VaultInitialized(uint256 duration,address adapter,uint256 fixedSideCapacity,uint256 variableSideCapacity,address variableAsset,uint256 feeBps,address feeReceiver,address indexed creator,address indexed vault)',
  'event FundsDeposited(uint256[] amounts,uint256 side,address indexed user)',
])

/** A fixed field order gives HTTP approval and DB jobs the same immutable digest. */
export function creationTerms(row) {
  const lower = value => typeof value === 'string' ? value.toLowerCase() : null
  return {
    requestId: row.requestId, chainId: row.chainId, submitterAddress: lower(row.submitterAddress),
    token0Address: lower(row.token0Address), token1Address: lower(row.token1Address),
    poolAddress: lower(row.poolAddress), feeTier: row.feeTier, adapterType: row.adapterType,
    minTick: row.minTick ?? null, maxTick: row.maxTick ?? null, durationSeconds: row.durationSeconds,
    fixedCapacityTokenAddress: lower(row.fixedCapacityTokenAddress), fixedCapacityAmount: row.fixedCapacityAmount,
    variableAssetAddress: lower(row.variableAssetAddress), variableAssetAmount: row.variableAssetAmount ?? null,
    useTargetApr: row.useTargetApr, targetApr: row.targetApr, factory: FACTORY,
  }
}
export const termsDigest = row => keccak256(stringToHex(JSON.stringify(creationTerms(row))))
export const sameAddress = (a, b) => validAddress(a) && validAddress(b) && a.toLowerCase() === b.toLowerCase()

/** App availability, not a contract-level reservation. Unknown/stale always closes the gate. */
export function eligibility(snapshot, now = Date.now()) {
  const unavailable = (state, reason) => ({ depositable: false, state, reason })
  if (!snapshot || !snapshot.verified || snapshot.chainId !== CHAIN_ID || !sameAddress(snapshot.factory, FACTORY)
    || !Number.isFinite(snapshot.headTimestamp) || !Number.isFinite(snapshot.checkedAt) || now - snapshot.checkedAt > MAX_OBSERVATION_AGE
    || snapshot.checkedAt > now + 1000 || now - snapshot.headTimestamp * 1000 > MAX_HEAD_AGE
    || snapshot.headTimestamp * 1000 > now + 5000 || !snapshot.canonical) {
    return unavailable('checking', 'Checking availability')
  }
  if (!['claimSupply','variableCapacity','variableSupply','variableBalance'].every(key => typeof snapshot[key] === 'string' && /^[0-9]+$/.test(snapshot[key]))) return unavailable('checking', 'Checking availability')
  if (!snapshot.initialized) return unavailable('creating', 'Initializing vault')
  if (snapshot.isStarted || BigInt(snapshot.claimSupply) !== 0n) return unavailable('occupied', 'Fixed side occupied / active')
  const capacity = BigInt(snapshot.variableCapacity)
  if (capacity <= 0n || BigInt(snapshot.variableSupply) !== capacity || BigInt(snapshot.variableBalance) < capacity) {
    return unavailable('awaiting_funding', 'Awaiting admin funding')
  }
  return { depositable: true, state: 'depositable', reason: 'Depositable' }
}

/** Origin- and action-bound authentication; never reuse request/payment signatures. */
export function adminSessionMessage(proof) {
  return ['Saffron operator session v1', 'Origin: ' + proof.origin, 'Wallet: ' + proof.wallet,
    'Chain: ' + CHAIN_ID, 'Nonce: ' + proof.nonce, 'Expires: ' + proof.expiresAt].join('\n')
}
