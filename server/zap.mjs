import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
} from 'viem'

const LIFI_QUOTE_URL = 'https://li.quest/v1/quote/contractCalls'
const SAFFRON_API_ORIGIN = 'https://api.saffron.finance'
const REQUEST_TIMEOUT_MS = 20_000
const MAX_REQUEST_BYTES = 64 * 1024
const MAX_RESPONSE_BYTES = 250 * 1024
const MAX_CALLDATA_BYTES = 32 * 1024
const MAX_UINT256 = (1n << 256n) - 1n
const MSG_SENDER_SENTINEL = '0x0000000000000000000000000000000000000001'
const UINT = /^\d+$/
const HEX_DATA = /^0x(?:[0-9a-fA-F]{2})+$/

// The same static trust boundary is repeated in the browser. A quote response
// can never nominate its own executor or ERC-20 approval spender.
const ZAP_CHAINS = {
  1: {
    factory: '0x7fE802B891734DB681b7353bFF9E6c85ce0ab200',
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    executor: '0xd9B2Da9C45b118e4e93A004FB1452bCDB6cC0E88',
    approval: '0x68E1Acfa805dcA813116Ed6507E01c38D44318f0',
  },
  42161: {
    factory: '0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2',
    router: '0x68b3465833fb72A70ecDF485E0e4C7bD8665Fc45',
    executor: '0x2dfaDAB8266483beD9Fd9A292Ce56596a2D1378D',
    approval: '0x5741A7FfE7c39Ca175546a54985fA79211290b51',
  },
  4663: {
    factory: '0xb24b143ad6bB5bE9559CcC75f34A2261b7456904',
    router: '0xCaf681a66D020601342297493863E78C959E5cb2',
    executor: '0x464fC28B9CbC1781286c8626B6E925275c8C14F1',
    approval: '0xfb3973800ADf5B997E910F2DD90158924370612A',
  },
}

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
    outputs: [{ type: 'uint256' }],
  },
]

const VAULT_ABI = [
  {
    name: 'deposit',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256' }, { type: 'uint256' }, { type: 'bytes' }],
    outputs: [],
  },
]

const EXECUTOR_ABI = [
  {
    name: 'swapAndExecute',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'transactionId', type: 'bytes32' },
      {
        name: 'swapData',
        type: 'tuple[]',
        components: [
          { name: 'callTo', type: 'address' },
          { name: 'approveTo', type: 'address' },
          { name: 'sendingAssetId', type: 'address' },
          { name: 'receivingAssetId', type: 'address' },
          { name: 'fromAmount', type: 'uint256' },
          { name: 'callData', type: 'bytes' },
          { name: 'requiresDeposit', type: 'bool' },
        ],
      },
      { name: 'transferredAssetId', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
]

class ZapError extends Error {
  constructor(message, status = 400, code = 'INVALID_ZAP_REQUEST', retryable = false) {
    super(message)
    this.name = 'ZapError'
    this.status = status
    this.code = code
    this.retryable = retryable
  }
}

function sameAddress(left, right) {
  return (
    typeof left === 'string' &&
    typeof right === 'string' &&
    isAddress(left) &&
    isAddress(right) &&
    isAddressEqual(getAddress(left), getAddress(right))
  )
}

function isUint256(value, { positive = false } = {}) {
  if (typeof value !== 'string' || value.length > 78 || !UINT.test(value)) return false
  const parsed = BigInt(value)
  return parsed <= MAX_UINT256 && (!positive || parsed > 0n)
}

function isBoundedCalldata(value) {
  return (
    typeof value === 'string' &&
    value.length <= 2 + MAX_CALLDATA_BYTES * 2 &&
    HEX_DATA.test(value)
  )
}

function parseInteger(value, label) {
  if (typeof value !== 'string' || !/^(?:0x[0-9a-fA-F]+|\d+)$/.test(value)) {
    throw new ZapError(`LI.FI returned an invalid ${label}`, 502, 'INVALID_LIFI_RESPONSE', true)
  }
  return BigInt(value)
}

/**
 * Validate the complete caller-authored call suffix before spending any LI.FI
 * quota. This endpoint cannot be repurposed as a generic arbitrary-call proxy.
 */
export function validateZapRequest(value) {
  if (!value || typeof value !== 'object') throw new ZapError('Invalid zap quote request')
  const chainId = Number(value.fromChain)
  const chain = ZAP_CHAINS[chainId]
  if (!chain || value.fromChain !== chainId || value.toChain !== chainId) {
    throw new ZapError('Unsupported zap chain')
  }
  if (
    !sameAddress(value.fromAddress, value.toFallbackAddress) ||
    !sameAddress(value.fromToken, value.toToken) ||
    !isAddress(value.contractOutputsToken)
  ) {
    throw new ZapError('Invalid direct-source zap identity')
  }
  if (!isUint256(value.toAmount, { positive: true })) throw new ZapError('Invalid zap amount')
  if (
    typeof value.slippage !== 'number' ||
    !Number.isFinite(value.slippage) ||
    value.slippage <= 0 ||
    value.slippage > 0.05
  ) {
    throw new ZapError('Zap slippage must be between 0 and 5%')
  }
  if (!Array.isArray(value.contractCalls) || value.contractCalls.length !== 4) {
    throw new ZapError('A direct fixed zap must contain exactly four calls')
  }
  for (const call of value.contractCalls) {
    if (
      !isUint256(call?.fromAmount, { positive: true }) ||
      !isAddress(call?.fromTokenAddress) ||
      !isAddress(call?.toTokenAddress) ||
      !isAddress(call?.toContractAddress) ||
      !isBoundedCalldata(call?.toContractCallData) ||
      !isUint256(call?.toContractGasLimit, { positive: true }) ||
      BigInt(call.toContractGasLimit) > 1_500_000n
    ) {
      throw new ZapError('Invalid fixed-deposit contract call')
    }
  }

  const [swapCall, token0Probe, token1Probe, depositCall] = value.contractCalls
  if (!sameAddress(swapCall.toContractAddress, chain.router)) {
    throw new ZapError('Zap does not target the trusted chain router')
  }
  if (swapCall.fromAmount !== value.toAmount) {
    throw new ZapError('Zap funding amount does not match the quote amount')
  }
  let swap
  try {
    const decoded = decodeFunctionData({ abi: SWAP_ROUTER_ABI, data: swapCall.toContractCallData })
    if (decoded.functionName !== 'exactInputSingle') throw new Error('wrong selector')
    ;[swap] = decoded.args
  } catch {
    throw new ZapError('Invalid Uniswap swap calldata')
  }
  if (
    !sameAddress(swap.tokenIn, value.fromToken) ||
    !sameAddress(swap.tokenIn, swapCall.fromTokenAddress) ||
    !sameAddress(swap.tokenOut, swapCall.toTokenAddress) ||
    !sameAddress(swap.recipient, MSG_SENDER_SENTINEL) ||
    swap.amountIn <= 0n ||
    swap.amountIn > BigInt(value.toAmount) ||
    swap.amountOutMinimum <= 0n ||
    swap.sqrtPriceLimitX96 !== 0n
  ) {
    throw new ZapError('Unsafe Uniswap swap parameters')
  }

  const probes = [token0Probe, token1Probe]
  if (
    !sameAddress(token0Probe.toContractAddress, token1Probe.toContractAddress) ||
    sameAddress(token0Probe.fromTokenAddress, token1Probe.fromTokenAddress) ||
    !probes.every(
      (call) =>
        sameAddress(call.fromTokenAddress, call.toTokenAddress) &&
        call.toContractCallData.toLowerCase() === '0x17d70f7c',
    )
  ) {
    throw new ZapError('Invalid adapter allowance probes')
  }
  const vaultTokens = probes.map((call) => getAddress(call.fromTokenAddress))
  if (
    !vaultTokens.some((token) => sameAddress(token, value.fromToken)) ||
    !vaultTokens.some((token) => sameAddress(token, swap.tokenOut))
  ) {
    throw new ZapError('Swap assets are not the destination vault pair')
  }
  if (
    !sameAddress(depositCall.fromTokenAddress, value.fromToken) ||
    !sameAddress(depositCall.toTokenAddress, value.contractOutputsToken)
  ) {
    throw new ZapError('Invalid fixed-deposit input or output token')
  }
  let deposit
  try {
    const decoded = decodeFunctionData({ abi: VAULT_ABI, data: depositCall.toContractCallData })
    if (decoded.functionName !== 'deposit') throw new Error('wrong selector')
    deposit = decoded.args
  } catch {
    throw new ZapError('Invalid Saffron deposit calldata')
  }
  if (
    deposit[0] !== 0n ||
    deposit[1] !== 0n ||
    typeof deposit[2] !== 'string' ||
    !/^0x[0-9a-fA-F]{192}$/.test(deposit[2])
  ) {
    throw new ZapError('Invalid fixed-side deposit parameters')
  }

  return {
    request: value,
    chainId,
    chain,
    vaultAddress: getAddress(depositCall.toContractAddress),
    adapterAddress: getAddress(token0Probe.toContractAddress),
    claimTokenAddress: getAddress(value.contractOutputsToken),
    token0: vaultTokens[0],
    token1: vaultTokens[1],
    poolFee: Number(swap.fee),
  }
}

const fixedVaultCache = new Map()

/** Load the same bounded public vault set that feeds the fixed-side table. */
export async function fetchFixedVaults(chainId) {
  if (!ZAP_CHAINS[chainId]) throw new ZapError('Unsupported vault chain', 404)
  const cached = fixedVaultCache.get(chainId)
  if (cached && Date.now() - cached.createdAt < 20_000) return cached.promise
  const promise = (async () => {
    const data = []
    let cursor
    for (let page = 0; page < 20; page += 1) {
      const upstreamUrl = new URL(`/api/v1/vaults/${chainId}/list`, SAFFRON_API_ORIGIN)
      const query = new URLSearchParams({
        status: 'Not Started',
        includeOutOfRange: 'true',
        includeStale: 'true',
        includeNegativePnl: 'true',
        includeUnfilledVariable: 'true',
        includeFilledVariable: 'true',
        sort: 'fixedAprDesc',
        pageSize: '50',
      })
      if (cursor) query.set('cursor', cursor)
      upstreamUrl.search = query.toString()
      const upstream = await fetch(upstreamUrl, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      })
      if (!upstream.ok) throw new ZapError('Saffron vault API unavailable', 502, 'VAULT_API_ERROR', true)
      const payload = await upstream.json()
      if (Array.isArray(payload?.data)) data.push(...payload.data)
      cursor = payload?.meta?.nextCursor || undefined
      if (!cursor) break
    }
    return data
  })()
  fixedVaultCache.set(chainId, { createdAt: Date.now(), promise })
  try {
    return await promise
  } catch (error) {
    fixedVaultCache.delete(chainId)
    throw error
  }
}

/** Bind browser-supplied addresses to one current, verified indexed vault. */
export async function validateZapDestination(validated) {
  const vaults = await fetchFixedVaults(validated.chainId)
  const row = vaults.find((candidate) =>
    sameAddress(candidate?.vault?.address, validated.vaultAddress),
  )
  if (!row) throw new ZapError('Zap destination vault is not indexed', 422)
  const factory = row?.vault?.factoryAddress
  const claimToken = row?.vault?.claimToken ?? row?.vaultTokens?.claimToken?.address
  const poolToken0 = row?.adapterTokens?.token0?.address ?? row?.adapter?.pool?.token0?.address
  const poolToken1 = row?.adapterTokens?.token1?.address ?? row?.adapter?.pool?.token1?.address
  if (row?.vaultInfo?.verified === false) {
    throw new ZapError('Zap destination vault failed bytecode verification', 422)
  }
  if (
    !sameAddress(factory, validated.chain.factory) ||
    !sameAddress(row?.vaultInfo?.adapterAddress, validated.adapterAddress) ||
    !sameAddress(claimToken, validated.claimTokenAddress) ||
    !sameAddress(poolToken0, validated.token0) ||
    !sameAddress(poolToken1, validated.token1) ||
    Number(row?.adapter?.pool?.fee ?? row?.adapter?.fee) !== validated.poolFee ||
    row?.vault?.status !== 'Not Started' ||
    !isUint256(String(row?.vault?.fixedSideCapacity ?? '0'), { positive: true }) ||
    BigInt(row?.vault?.claimTokenSupply ?? 0) !== 0n
  ) {
    throw new ZapError('Zap destination no longer matches the indexed vault', 422)
  }
}

/** Validate LI.FI's executor envelope and each decoded destination call. */
export function validateLifiResponse(validated, quote) {
  const request = validated.request
  const tx = quote?.transactionRequest
  if (
    !tx ||
    !isAddress(tx.to) ||
    !isAddress(tx.from) ||
    !isBoundedCalldata(tx.data) ||
    !sameAddress(tx.to, validated.chain.executor) ||
    !sameAddress(tx.from, request.fromAddress) ||
    Number(tx.chainId) !== validated.chainId
  ) {
    throw new ZapError('LI.FI returned an invalid transaction', 502, 'INVALID_LIFI_RESPONSE', true)
  }
  const sourceAmount = parseInteger(quote?.estimate?.fromAmount, 'source amount')
  if (sourceAmount !== BigInt(request.toAmount)) {
    throw new ZapError('LI.FI changed the source amount', 502, 'INVALID_LIFI_RESPONSE', true)
  }
  if (!sameAddress(quote?.estimate?.approvalAddress, validated.chain.approval)) {
    throw new ZapError('LI.FI returned an unsupported approval address', 502, 'INVALID_LIFI_RESPONSE', true)
  }
  if (parseInteger(tx.value ?? '0', 'transaction value') !== 0n) {
    throw new ZapError('LI.FI returned unexpected native value', 502, 'INVALID_LIFI_RESPONSE', true)
  }

  let decoded
  try {
    decoded = decodeFunctionData({ abi: EXECUTOR_ABI, data: tx.data })
  } catch {
    throw new ZapError('LI.FI returned unsupported calldata', 502, 'INVALID_LIFI_RESPONSE', true)
  }
  if (decoded.functionName !== 'swapAndExecute') {
    throw new ZapError('LI.FI returned unsupported calldata', 502, 'INVALID_LIFI_RESPONSE', true)
  }
  const [transactionId, swaps, transferredAssetId, receiver, amount] = decoded.args
  const canonical = encodeFunctionData({
    abi: EXECUTOR_ABI,
    functionName: 'swapAndExecute',
    args: [transactionId, swaps, transferredAssetId, receiver, amount],
  })
  if (
    canonical.toLowerCase() !== tx.data.toLowerCase() ||
    !sameAddress(transferredAssetId, request.fromToken) ||
    !sameAddress(receiver, request.toFallbackAddress) ||
    amount !== sourceAmount ||
    swaps.length !== request.contractCalls.length
  ) {
    throw new ZapError('LI.FI changed the fixed-deposit intent', 502, 'INVALID_LIFI_RESPONSE', true)
  }

  const introducedAssets = new Set()
  for (let index = 0; index < request.contractCalls.length; index += 1) {
    const expected = request.contractCalls[index]
    const actual = swaps[index]
    const sendingAsset = getAddress(actual.sendingAssetId)
    const expectedRequiresDeposit = !introducedAssets.has(sendingAsset.toLowerCase())
    if (
      !sameAddress(actual.callTo, expected.toContractAddress) ||
      !sameAddress(actual.approveTo, expected.toContractAddress) ||
      !sameAddress(actual.sendingAssetId, expected.fromTokenAddress) ||
      !sameAddress(actual.receivingAssetId, expected.toTokenAddress) ||
      actual.fromAmount !== BigInt(expected.fromAmount) ||
      actual.callData.toLowerCase() !== expected.toContractCallData.toLowerCase() ||
      actual.requiresDeposit !== expectedRequiresDeposit
    ) {
      throw new ZapError(
        `LI.FI changed fixed-deposit call ${index + 1}`,
        502,
        'INVALID_LIFI_RESPONSE',
        true,
      )
    }
    introducedAssets.add(sendingAsset.toLowerCase())
    introducedAssets.add(getAddress(actual.receivingAssetId).toLowerCase())
  }
  return quote
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    let settled = false
    req.on('data', (chunk) => {
      if (settled) return
      body += chunk
      if (Buffer.byteLength(body) > MAX_REQUEST_BYTES) {
        settled = true
        reject(new ZapError('Zap request body is too large', 413))
      }
    })
    req.on('end', () => {
      if (!settled) resolve(body)
    })
    req.on('error', (error) => {
      if (!settled) reject(error)
    })
  })
}

async function readBoundedResponse(response) {
  const declared = response.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > MAX_RESPONSE_BYTES) {
    throw new ZapError('LI.FI response was too large', 502, 'INVALID_LIFI_RESPONSE', true)
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    bytes += value.byteLength
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel().catch(() => undefined)
      throw new ZapError('LI.FI response was too large', 502, 'INVALID_LIFI_RESPONSE', true)
    }
    chunks.push(value)
  }
  const merged = new Uint8Array(bytes)
  let offset = 0
  for (const chunk of chunks) {
    merged.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(merged)
}

async function fetchLifiQuote(validated) {
  const apiKey = process.env.LIFI_API_KEY
  if (!apiKey) throw new ZapError('Zap quote service is not configured', 503, 'ZAPS_DISABLED')
  const response = await fetch(LIFI_QUOTE_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: {
      'content-type': 'application/json',
      'x-lifi-api-key': apiKey,
      'user-agent': 'Saffron-Scaffold-Zap/1.0',
    },
    body: JSON.stringify({
      ...validated.request,
      integrator: process.env.LIFI_INTEGRATOR || 'saffron-lifi',
    }),
  })
  const text = await readBoundedResponse(response)
  let payload
  try {
    payload = JSON.parse(text)
  } catch {
    payload = null
  }
  if (!response.ok) {
    const detail =
      typeof payload?.message === 'string'
        ? payload.message
        : typeof payload?.error === 'string'
          ? payload.error
          : `LI.FI quote failed (HTTP ${response.status})`
    throw new ZapError(detail.slice(0, 180), response.status, 'LIFI_QUOTE_FAILED', true)
  }
  return validateLifiResponse(validated, payload)
}

const quoteWindow = []

function withinRateLimit() {
  const now = Date.now()
  while (quoteWindow.length && quoteWindow[0] <= now - 60_000) quoteWindow.shift()
  const configured = Number(process.env.RATE_LIMIT_ZAP_QUOTE_GLOBAL_PER_MIN)
  const limit = Number.isFinite(configured) && configured > 0 ? Math.floor(configured) : 60
  if (quoteWindow.length >= limit) return false
  quoteWindow.push(now)
  return true
}

function endJson(res, status, payload) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'private, no-store',
  })
  res.end(JSON.stringify(payload))
}

/** Handle the one same-origin mutation-free quote endpoint. */
export async function handleZapQuote(req, res) {
  if (req.method !== 'POST') {
    endJson(res, 405, { success: false, error: 'POST only' })
    return
  }
  if (process.env.ZAP_QUOTES_ENABLED === 'false') {
    endJson(res, 503, {
      success: false,
      error: 'Zap deposits are temporarily disabled',
      code: 'ZAPS_DISABLED',
      retryable: false,
    })
    return
  }
  if (!withinRateLimit()) {
    endJson(res, 429, {
      success: false,
      error: 'Too many zap quote requests',
      code: 'RATE_LIMITED',
      retryable: true,
    })
    return
  }
  try {
    const raw = await readBody(req)
    let body
    try {
      body = JSON.parse(raw)
    } catch {
      throw new ZapError('Invalid JSON body')
    }
    const validated = validateZapRequest(body)
    await validateZapDestination(validated)
    const data = await fetchLifiQuote(validated)
    endJson(res, 200, { success: true, data, timestamp: new Date().toISOString() })
  } catch (error) {
    const known = error instanceof ZapError
    endJson(res, known ? error.status : 500, {
      success: false,
      error: known ? error.message : 'Unable to create a zap quote',
      code: known ? error.code : 'INTERNAL_ERROR',
      retryable: known ? error.retryable : true,
    })
  }
}

export { EXECUTOR_ABI, SWAP_ROUTER_ABI, VAULT_ABI, ZAP_CHAINS }
