import assert from 'node:assert/strict'
import { after, describe, it } from 'node:test'

import { encodeFunctionData } from 'viem'
import { createServer } from 'vite'

import {
  EXECUTOR_ABI,
  validateLifiResponse,
  validateZapRequest,
  ZAP_CHAINS,
} from '../server/zap.mjs'

// Vite's SSR loader resolves the application's extensionless TypeScript
// imports exactly as the production build does. This keeps the tests on the
// real browser modules without adding a second TypeScript runner.
const vite = await createServer({
  appType: 'custom',
  logLevel: 'silent',
  server: { middlewareMode: true },
})
after(async () => vite.close())

const math = await vite.ssrLoadModule('/src/zap/math.ts')
const callsModule = await vite.ssrLoadModule('/src/zap/calls.ts')
const model = await vite.ssrLoadModule('/src/fixedVaults/model.ts')
const browserValidation = await vite.ssrLoadModule('/src/zap/validate.ts')

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'
const VAULT = '0xbac19bda585b5ea38df938fd0f0218549011c919'
const ADAPTER = '0x961d5f2d9b96ed06312ff5c0e29e93ace327f373'
const CLAIM = '0xcCAE57404112e13Dc8697D341906881c0F1567d3'
const ACCOUNT = '0x1111111111111111111111111111111111111111'
const TRANSACTION_ID = `0x${'12'.repeat(32)}`
const APPROVE_SELECTOR = '0x095ea7b3'

// Mainnet vault 0xbac19bda..., the same fixture that was executed on a fork in
// the source branch. The reference integers below came from an independent
// TickMath/LiquidityAmounts implementation and protect against silent drift.
const MID_RANGE = {
  liquidity: 11410240645522147n,
  tickLower: 199690,
  tickUpper: 203620,
  tickCurrent: 200939,
}

const BUILD_PARAMS = {
  ...MID_RANGE,
  tickBand: 25,
  vaultAddress: VAULT,
  adapterAddress: ADAPTER,
  claimTokenAddress: CLAIM,
  token0: USDC,
  token1: WETH,
  poolFee: 500,
  sqrtPriceX96: 1831621792039044936295526612090113n,
  deployCapitalData: `0x${'00'.repeat(96)}`,
  chainId: 1,
  swapAmountOutMinimum: 1n,
}

function buildIntent() {
  const plan = callsModule.buildZapContractCalls(BUILD_PARAMS)
  return {
    plan,
    request: {
      fromChain: 1,
      fromToken: plan.deliverToken,
      fromAddress: ACCOUNT,
      toChain: 1,
      toToken: plan.deliverToken,
      toAmount: plan.deliverAmount.toString(),
      contractCalls: plan.calls,
      contractOutputsToken: CLAIM,
      toFallbackAddress: ACCOUNT,
      slippage: 0.005,
    },
  }
}

/**
 * Wrap the locally authored calls in the exact executor envelope returned by
 * LI.FI. Optional overrides let each negative test mutate one trust boundary
 * while preserving otherwise canonical ABI calldata.
 */
function makeQuote(request, overrides = {}) {
  const swaps = overrides.swaps ?? request.contractCalls.map((call, index) => ({
    callTo: call.toContractAddress,
    approveTo: call.toContractAddress,
    sendingAssetId: call.fromTokenAddress,
    receivingAssetId: call.toTokenAddress,
    fromAmount: BigInt(call.fromAmount),
    callData: call.toContractCallData,
    // The first call introduces both vault assets. All later calls consume
    // assets already held by the executor and therefore cannot re-deposit.
    requiresDeposit: index === 0,
  }))
  const receiver = overrides.receiver ?? request.toFallbackAddress
  const amount = overrides.amount ?? BigInt(request.toAmount)
  const transferredAsset = overrides.transferredAsset ?? request.fromToken
  return {
    estimate: {
      approvalAddress: overrides.approvalAddress ?? ZAP_CHAINS[1].approval,
      fromAmount: (overrides.sourceAmount ?? BigInt(request.toAmount)).toString(),
      gasCosts: [],
      feeCosts: [],
    },
    transactionRequest: {
      from: overrides.from ?? request.fromAddress,
      to: overrides.to ?? ZAP_CHAINS[1].executor,
      chainId: overrides.chainId ?? 1,
      value: overrides.value ?? '0',
      data: encodeFunctionData({
        abi: EXECUTOR_ABI,
        functionName: 'swapAndExecute',
        args: [TRANSACTION_ID, swaps, transferredAsset, receiver, amount],
      }),
    },
  }
}

describe('fork-validated zap sizing', () => {
  const reference = {
    0: { amount0: 62035611759n, amount1: 15937959610469254876n },
    25: { amount0: 62654108989n, amount1: 16267244153252048096n },
    50: { amount0: 63273379786n, amount1: 16596940538469440252n },
    100: { amount0: 64514245949n, amount1: 17257570897248900188n },
    200: { amount0: 67005303721n, amount1: 18583796431595506626n },
    500: { amount0: 74553642801n, amount1: 22602490875635208118n },
  }

  for (const [band, expected] of Object.entries(reference)) {
    it(`matches the independent reference at +/-${band} ticks`, () => {
      assert.deepEqual(
        math.getWorstCaseAmountsForTickBand({ ...MID_RANGE, tickBand: Number(band) }),
        expected,
      )
    })
  }

  it('never shrinks either leg as the safety band widens', () => {
    let previous = math.getWorstCaseAmountsForTickBand({ ...MID_RANGE, tickBand: 0 })
    for (const tickBand of [25, 50, 100, 200, 500]) {
      const next = math.getWorstCaseAmountsForTickBand({ ...MID_RANGE, tickBand })
      assert.ok(next.amount0 >= previous.amount0)
      assert.ok(next.amount1 >= previous.amount1)
      previous = next
    }
  })

  it('rejects unbounded range-edge overhead', () => {
    const result = math.getZapViability({
      liquidity: MID_RANGE.liquidity,
      tickLower: 199690,
      tickUpper: 201000,
      tickCurrent: 201100,
      tickBand: 200,
    })
    assert.deepEqual(result, { viable: false, unbounded: true, worstOverheadBps: null })
  })

  it('round-trips exact Uniswap ticks without floating point', () => {
    for (const tick of [-887271, -200000, -1, 0, 1, 200939, 887271]) {
      assert.equal(math.sqrtPriceX96ToTick(model.sqrtRatioAtTick(tick)), tick)
    }
  })
})

describe('direct-source contract-call plan', () => {
  it('builds only the reviewed swap, two probes, and deposit calls', () => {
    const { plan } = buildIntent()
    assert.equal(plan.calls.length, 4)
    assert.equal(plan.calls[0].toContractAddress, ZAP_CHAINS[1].router)
    assert.equal(BigInt(plan.calls[0].fromAmount), plan.deliverAmount)
    assert.equal(plan.calls.at(-1).toContractAddress, VAULT)
    assert.equal(plan.calls.at(-1).toTokenAddress, CLAIM)
    assert.equal(BigInt(plan.calls.at(-1).fromAmount), plan.deliverAmount - plan.swapAmount)
  })

  it('never asks LI.FI to execute a token approve or target a pool token', () => {
    const { plan } = buildIntent()
    for (const call of plan.calls) {
      assert.equal(call.toContractCallData.startsWith(APPROVE_SELECTOR), false)
      assert.ok(call.toContractAddress.toLowerCase() !== USDC.toLowerCase())
      assert.ok(call.toContractAddress.toLowerCase() !== WETH.toLowerCase())
      assert.ok(BigInt(call.fromAmount) > 0n)
    }
    const probes = plan.calls.filter(
      (call) => call.toContractAddress.toLowerCase() === ADAPTER.toLowerCase(),
    )
    assert.equal(probes.length, 2)
    assert.deepEqual(
      probes.map((call) => call.fromTokenAddress.toLowerCase()).sort(),
      [USDC.toLowerCase(), WETH.toLowerCase()].sort(),
    )
  })

  it('honors either vault leg as the direct source', () => {
    const token0 = callsModule.buildZapContractCalls({
      ...BUILD_PARAMS,
      preferredDeliverToken: USDC,
    })
    const token1 = callsModule.buildZapContractCalls({
      ...BUILD_PARAMS,
      preferredDeliverToken: WETH,
    })
    assert.equal(token0.deliverToken, USDC)
    assert.equal(token1.deliverToken, WETH)
  })

  it('requires a real swap floor and a statically supported router', () => {
    assert.throws(
      () => callsModule.buildZapContractCalls({ ...BUILD_PARAMS, swapAmountOutMinimum: 0n }),
      /swapAmountOutMinimum/,
    )
    assert.throws(
      () => callsModule.buildZapContractCalls({ ...BUILD_PARAMS, chainId: 43114 }),
      /No verified Uniswap SwapRouter/,
    )
  })
})

describe('server request boundary', () => {
  it('accepts the narrow four-call direct-source intent', () => {
    const { request } = buildIntent()
    const validated = validateZapRequest(request)
    assert.equal(validated.chainId, 1)
    assert.equal(validated.vaultAddress.toLowerCase(), VAULT.toLowerCase())
    assert.equal(validated.adapterAddress.toLowerCase(), ADAPTER.toLowerCase())
  })

  it('rejects cross-chain, arbitrary-router, and excessive-slippage requests', () => {
    const { request } = buildIntent()
    assert.throws(() => validateZapRequest({ ...request, toChain: 42161 }), /Unsupported zap chain/)
    assert.throws(() => validateZapRequest({ ...request, slippage: 0.051 }), /between 0 and 5%/)
    assert.throws(
      () => validateZapRequest({
        ...request,
        contractCalls: [
          { ...request.contractCalls[0], toContractAddress: ACCOUNT },
          ...request.contractCalls.slice(1),
        ],
      }),
      /trusted chain router/,
    )
  })
})

describe('LI.FI response boundary', () => {
  it('accepts one canonical envelope in both server and browser validators', () => {
    const { request } = buildIntent()
    const quote = makeQuote(request)
    const validated = validateZapRequest(request)
    assert.equal(validateLifiResponse(validated, quote), quote)
    assert.equal(browserValidation.validateZapQuote(request, quote).sourceAmount, BigInt(request.toAmount))
  })

  it('rejects a changed receiver, executor, approval target, or native value', () => {
    const { request } = buildIntent()
    const validated = validateZapRequest(request)
    const cases = [
      makeQuote(request, { receiver: ZAP_CHAINS[1].executor }),
      makeQuote(request, { to: ACCOUNT }),
      makeQuote(request, { approvalAddress: ACCOUNT }),
      makeQuote(request, { value: '1' }),
    ]
    for (const quote of cases) {
      assert.throws(() => validateLifiResponse(validated, quote))
      assert.throws(() => browserValidation.validateZapQuote(request, quote))
    }
  })

  it('rejects inserted calls and changed per-call funding semantics', () => {
    const { request } = buildIntent()
    const validated = validateZapRequest(request)
    const base = makeQuote(request)
    const decodedSwaps = request.contractCalls.map((call, index) => ({
      callTo: call.toContractAddress,
      approveTo: call.toContractAddress,
      sendingAssetId: call.fromTokenAddress,
      receivingAssetId: call.toTokenAddress,
      fromAmount: BigInt(call.fromAmount),
      callData: call.toContractCallData,
      requiresDeposit: index === 0,
    }))
    const inserted = makeQuote(request, { swaps: [...decodedSwaps, decodedSwaps.at(-1)] })
    const changedFunding = makeQuote(request, {
      swaps: decodedSwaps.map((swap, index) =>
        index === 1 ? { ...swap, requiresDeposit: true } : swap,
      ),
    })
    assert.doesNotThrow(() => validateLifiResponse(validated, base))
    for (const quote of [inserted, changedFunding]) {
      assert.throws(() => validateLifiResponse(validated, quote))
      assert.throws(() => browserValidation.validateZapQuote(request, quote))
    }
  })
})
