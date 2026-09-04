import {
  encodeAbiParameters,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  zeroAddress,
  type Address,
  type Hex,
  type PublicClient,
} from 'viem'

import { clientFor } from '../chain/clients'
import type { FixedVault } from '../fixedVaults/model'

import {
  TICK_BAND_SAME_CHAIN,
  ZAP_CHAIN_CONFIG,
  ZAP_MAX_SLIPPAGE_BPS,
  isZapSupportedChainId,
} from './config'
import {
  getMinAmountsWithSlippage,
  getZapSizing,
  getZapViability,
  sqrtPriceX96ToTick,
  type ZapSizingParams,
} from './math'
import type { PreparedZap, ZapContractCall, ZapPlan, ZapSupportedChainId } from './types'

const MSG_SENDER_SENTINEL = '0x0000000000000000000000000000000000000001' as const
const FIXED_SIDE = 0n
const QUOTE_DEADLINE_SECONDS = 30n * 60n

const SWAP_ROUTER_ABI = [
  {
    name: 'exactInputSingle',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

const VAULT_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'fixedSideCapacity',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'claimToken',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'adapter',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

const ADAPTER_ABI = [
  {
    name: 'tokenId',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'pool',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

const POOL_ABI = [
  {
    name: 'slot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  {
    name: 'fee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint24' }],
  },
  {
    name: 'tickSpacing',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'int24' }],
  },
  {
    name: 'token0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'token1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
] as const

const ERC20_SUPPLY_ABI = [
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const QUOTER_V2_ABI = [
  {
    name: 'quoteExactOutputSingle',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'amount', type: 'uint256' },
          { name: 'fee', type: 'uint24' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'sqrtPriceX96After', type: 'uint160' },
      { name: 'initializedTicksCrossed', type: 'uint32' },
      { name: 'gasEstimate', type: 'uint256' },
    ],
  },
] as const

export interface BuildZapParams extends ZapSizingParams {
  vaultAddress: Address
  adapterAddress: Address
  claimTokenAddress: Address
  token0: Address
  token1: Address
  poolFee: number
  sqrtPriceX96: bigint
  deployCapitalData: Hex
  chainId: ZapSupportedChainId
  swapSlippageBps?: number
  swapAmountIn?: bigint
  swapAmountOutMinimum?: bigint
  preferredDeliverToken?: Address
}

/**
 * Build the four-call direct-source route proven by the fixed-income branch:
 * swap part of one vault token, grant the adapter both allowances through
 * harmless `tokenId()` probes, then deposit and sweep the claim token.
 */
export function buildZapContractCalls(params: BuildZapParams): ZapPlan {
  const chain = ZAP_CHAIN_CONFIG[params.chainId]
  if (!chain) {
    throw new Error(`No verified Uniswap SwapRouter for chain ${params.chainId}`)
  }
  const { amount0, amount1 } = getZapSizing(params)
  const priceX192 = params.sqrtPriceX96 * params.sqrtPriceX96
  const amount1InToken0 =
    priceX192 === 0n ? 0n : (amount1 * Q96 * Q96) / priceX192
  const preferred = params.preferredDeliverToken?.toLowerCase()
  const deliverToken0 =
    preferred === params.token0.toLowerCase()
      ? true
      : preferred === params.token1.toLowerCase()
        ? false
        : amount0 >= amount1InToken0
  const deliverToken = deliverToken0 ? params.token0 : params.token1
  const otherToken = deliverToken0 ? params.token1 : params.token0
  const spotSwapAmount = deliverToken0
    ? amount1 > 0n
      ? amount1InToken0
      : 0n
    : amount0 > 0n
      ? (amount0 * priceX192) / (Q96 * Q96)
      : 0n
  const swapBase =
    params.swapAmountIn !== undefined && params.swapAmountIn > 0n
      ? params.swapAmountIn
      : spotSwapAmount
  const swapSlippageBps = Math.max(0, Math.round(params.swapSlippageBps ?? 300))
  const swapAmount =
    spotSwapAmount === 0n
      ? 0n
      : (swapBase * BigInt(10_000 + swapSlippageBps)) / 10_000n
  const keepAmount = deliverToken0 ? amount0 : amount1
  const deliverAmount = keepAmount + swapAmount
  const calls: ZapContractCall[] = []

  if (swapAmount > 0n) {
    if (!params.swapAmountOutMinimum || params.swapAmountOutMinimum <= 0n) {
      throw new Error('swapAmountOutMinimum must be > 0 when a zap includes a swap')
    }
    calls.push({
      // LI.FI funds its executor from the first call's declared amount. The
      // router consumes only `swapAmount`; the remainder stays for deposit.
      fromAmount: deliverAmount.toString(),
      fromTokenAddress: deliverToken,
      toTokenAddress: otherToken,
      toContractAddress: chain.router,
      toContractCallData: encodeFunctionData({
        abi: SWAP_ROUTER_ABI,
        functionName: 'exactInputSingle',
        args: [
          {
            tokenIn: deliverToken,
            tokenOut: otherToken,
            fee: params.poolFee,
            recipient: MSG_SENDER_SENTINEL,
            amountIn: swapAmount,
            amountOutMinimum: params.swapAmountOutMinimum,
            sqrtPriceLimitX96: 0n,
          },
        ],
      }),
      toContractGasLimit: '400000',
    })
  }

  // Never encode ERC-20 approve as a destination call. LI.FI auto-approves
  // `fromToken -> toContract`, so an approve call would become a token
  // self-approval and can revert for Blacklistable assets.
  for (const [token, amount] of [
    [params.token0, amount0],
    [params.token1, amount1],
  ] as const) {
    calls.push({
      // LI.FI rejects a zero declared amount. One raw unit is harmless for a
      // single-sided leg and still causes the adapter allowance to be granted.
      fromAmount: (amount || 1n).toString(),
      fromTokenAddress: token,
      toTokenAddress: token,
      toContractAddress: params.adapterAddress,
      toContractCallData: encodeFunctionData({
        abi: ADAPTER_ABI,
        functionName: 'tokenId',
      }),
      toContractGasLimit: '80000',
    })
  }

  calls.push({
    fromAmount: keepAmount.toString(),
    fromTokenAddress: deliverToken,
    toTokenAddress: params.claimTokenAddress,
    toContractAddress: params.vaultAddress,
    toContractCallData: encodeFunctionData({
      abi: VAULT_ABI,
      functionName: 'deposit',
      args: [0n, FIXED_SIDE, params.deployCapitalData],
    }),
    toContractGasLimit: '1400000',
  })

  return { deliverToken, deliverAmount, swapAmount, calls }
}

async function quoteExactOutputInput({
  client,
  chainId,
  tokenIn,
  tokenOut,
  fee,
  amountOut,
}: {
  client: PublicClient
  chainId: ZapSupportedChainId
  tokenIn: Address
  tokenOut: Address
  fee: number
  amountOut: bigint
}) {
  const { result } = await client.simulateContract({
    address: ZAP_CHAIN_CONFIG[chainId].quoter,
    abi: QUOTER_V2_ABI,
    functionName: 'quoteExactOutputSingle',
    account: zeroAddress,
    args: [{ tokenIn, tokenOut, amount: amountOut, fee, sqrtPriceLimitX96: 0n }],
  })
  const [amountIn, sqrtPriceX96After] = result
  return { amountIn, sqrtPriceX96After }
}

/**
 * Re-read every destination identity and live pool value before constructing a
 * quote. Cached table data is presentation only and never the transaction's
 * trust boundary.
 */
export async function prepareZap(
  vault: FixedVault,
  sourceToken: Address,
  account: Address,
  slippageBps: number,
): Promise<PreparedZap> {
  if (!isZapSupportedChainId(vault.chainId)) {
    throw new Error('Zaps are not supported on this network')
  }
  if (slippageBps <= 0 || slippageBps > ZAP_MAX_SLIPPAGE_BPS) {
    throw new Error(`Zap slippage must be between 0.01% and ${ZAP_MAX_SLIPPAGE_BPS / 100}%`)
  }
  const token0 = getAddress(vault.token0.address)
  const token1 = getAddress(vault.token1.address)
  if (!isAddressEqual(sourceToken, token0) && !isAddressEqual(sourceToken, token1)) {
    throw new Error('Choose one of the two vault tokens for this minimal zap')
  }
  const client = clientFor(vault.chainKey)
  if (!client) throw new Error(`${vault.chainLabel} RPC is unavailable`)

  const [slot0, poolFee, tickSpacing, poolToken0, poolToken1, adapter, adapterPool, capacity,
    claimToken, block] = await Promise.all([
    client.readContract({ address: vault.pool.address, abi: POOL_ABI, functionName: 'slot0' }),
    client.readContract({ address: vault.pool.address, abi: POOL_ABI, functionName: 'fee' }),
    client.readContract({ address: vault.pool.address, abi: POOL_ABI, functionName: 'tickSpacing' }),
    client.readContract({ address: vault.pool.address, abi: POOL_ABI, functionName: 'token0' }),
    client.readContract({ address: vault.pool.address, abi: POOL_ABI, functionName: 'token1' }),
    client.readContract({ address: vault.address, abi: VAULT_ABI, functionName: 'adapter' }),
    client.readContract({ address: vault.adapterAddress, abi: ADAPTER_ABI, functionName: 'pool' }),
    client.readContract({
      address: vault.address,
      abi: VAULT_ABI,
      functionName: 'fixedSideCapacity',
    }),
    client.readContract({ address: vault.address, abi: VAULT_ABI, functionName: 'claimToken' }),
    client.getBlock({ blockTag: 'latest' }),
  ])
  if (!isAddressEqual(adapter, vault.adapterAddress)) {
    throw new Error('The live vault adapter no longer matches this vault')
  }
  if (!isAddressEqual(adapterPool, vault.pool.address)) {
    throw new Error('The live adapter pool no longer matches this vault')
  }
  if (!isAddressEqual(poolToken0, token0) || !isAddressEqual(poolToken1, token1)) {
    throw new Error('The live pool tokens no longer match this vault')
  }
  if (Number(tickSpacing) !== vault.pool.tickSpacing) {
    throw new Error('The live pool tick spacing no longer matches this vault')
  }
  const claimSupply = await client.readContract({
    address: claimToken,
    abi: ERC20_SUPPLY_ABI,
    functionName: 'totalSupply',
  })
  if (claimSupply !== 0n) throw new Error('This fixed side has already been filled')
  if (capacity <= 0n) throw new Error('This vault has no fixed-side capacity')

  const sqrtPriceX96 = slot0[0]
  const tickCurrent = Number(slot0[1])
  if (tickCurrent < vault.minTick || tickCurrent >= vault.maxTick) {
    throw new Error(
      "Zap unavailable: the pool price is outside this vault's range. Deposit both tokens instead.",
    )
  }
  const baseSizing: ZapSizingParams = {
    liquidity: capacity,
    tickLower: vault.minTick,
    tickUpper: vault.maxTick,
    tickCurrent,
    tickBand: TICK_BAND_SAME_CHAIN,
  }
  const viability = getZapViability(baseSizing)
  if (!viability.viable) {
    throw new Error(
      viability.unbounded
        ? 'Zap unavailable: the required buffer is unbounded at this range edge'
        : `Zap unavailable: required overhead is ${(
            (viability.worstOverheadBps ?? 0) / 100
          ).toFixed(1)}%`,
    )
  }

  const common = {
    vaultAddress: getAddress(vault.address),
    adapterAddress: getAddress(vault.adapterAddress),
    claimTokenAddress: getAddress(claimToken),
    token0,
    token1,
    poolFee: Number(poolFee),
    sqrtPriceX96,
    chainId: vault.chainId,
    swapSlippageBps: slippageBps,
    preferredDeliverToken: getAddress(sourceToken),
  }
  const placeholder = `0x${'00'.repeat(96)}` as Hex
  const draft = buildZapContractCalls({
    ...common,
    ...baseSizing,
    deployCapitalData: placeholder,
    swapAmountOutMinimum: 1n,
  })
  const deliversToken0 = isAddressEqual(draft.deliverToken, token0)
  const otherToken = deliversToken0 ? token1 : token0
  const otherLegOf = (amounts: ZapAmounts) =>
    deliversToken0 ? amounts.amount1 : amounts.amount0

  // Quote against the vault's own pool, then widen the tick band until it also
  // covers the post-swap price. This includes fee, impact, and crossed ticks.
  let sizing = baseSizing
  let minimumOtherLeg = 1n
  let swapAmountIn: bigint | undefined
  let sqrtPriceAtMint = sqrtPriceX96
  if (draft.swapAmount > 0n) {
    for (let pass = 0; ; pass += 1) {
      minimumOtherLeg = otherLegOf(getZapSizing(sizing))
      const quoted = await quoteExactOutputInput({
        client,
        chainId: vault.chainId,
        tokenIn: draft.deliverToken,
        tokenOut: otherToken,
        fee: Number(poolFee),
        amountOut: minimumOtherLeg,
      })
      swapAmountIn = quoted.amountIn
      sqrtPriceAtMint = quoted.sqrtPriceX96After
      const tickAfter = sqrtPriceX96ToTick(sqrtPriceAtMint)
      const covered =
        Math.abs(tickAfter - sizing.tickCurrent) + TICK_BAND_SAME_CHAIN <= sizing.tickBand
      if (covered || pass === 3) break
      sizing = {
        ...baseSizing,
        tickCurrent: Math.round((tickCurrent + tickAfter) / 2),
        tickBand: Math.ceil(Math.abs(tickAfter - tickCurrent) / 2) + TICK_BAND_SAME_CHAIN,
      }
    }
  }

  const { amount0Min, amount1Min } = getMinAmountsWithSlippage({
    liquidity: capacity,
    tickLower: vault.minTick,
    tickUpper: vault.maxTick,
    sqrtPriceX96: sqrtPriceAtMint,
    slippageBps,
  })
  const deployCapitalData = encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint256' }, { type: 'uint256' }],
    [amount0Min, amount1Min, block.timestamp + QUOTE_DEADLINE_SECONDS],
  )
  const plan = buildZapContractCalls({
    ...common,
    ...sizing,
    deployCapitalData,
    preferredDeliverToken: draft.deliverToken,
    swapAmountOutMinimum: minimumOtherLeg || 1n,
    swapAmountIn,
  })
  const deliverToken = isAddressEqual(plan.deliverToken, token0) ? vault.token0 : vault.token1
  const request = {
    fromChain: vault.chainId,
    fromToken: plan.deliverToken,
    fromAddress: getAddress(account),
    toChain: vault.chainId,
    toToken: plan.deliverToken,
    toAmount: plan.deliverAmount.toString(),
    contractCalls: plan.calls,
    contractOutputsToken: getAddress(claimToken),
    toFallbackAddress: getAddress(account),
    slippage: slippageBps / 10_000,
  } as const

  return {
    plan,
    request,
    deliverTokenSymbol: deliverToken.symbol,
    deliverTokenDecimals: deliverToken.decimals,
  }
}

// Keep Q96 local to the call builder: it is the raw-price bridge between both
// token legs and should never be replaced with floating-point token prices.
const Q96 = 1n << 96n

type ZapAmounts = ReturnType<typeof getZapSizing>
