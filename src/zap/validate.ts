import {
  decodeFunctionData,
  encodeFunctionData,
  getAddress,
  isAddress,
  isAddressEqual,
  type Address,
} from 'viem'

import { ZAP_CHAIN_CONFIG } from './config'
import type { ZapQuote, ZapQuoteRequest } from './types'

const UINT = /^\d+$/

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
] as const

function sameAddress(left: string | undefined, right: string): boolean {
  return !!left && isAddress(left) && isAddressEqual(getAddress(left), getAddress(right))
}

function parseInteger(value: string | undefined, label: string): bigint {
  if (value === undefined || !/^(?:0x[0-9a-fA-F]+|\d+)$/.test(value)) {
    throw new Error(`LI.FI returned an invalid ${label}`)
  }
  return BigInt(value)
}

/**
 * Bind an untrusted LI.FI response back to every field of the locally prepared
 * intent. The server performs the same check; repeating it immediately before
 * wallet use preserves a separate browser-side trust boundary.
 */
export function validateZapQuote(intent: ZapQuoteRequest, quote: ZapQuote) {
  const tx = quote.transactionRequest
  const chain = ZAP_CHAIN_CONFIG[intent.fromChain]
  if (!tx || !isAddress(tx.to) || !tx.data || !tx.from || !isAddress(tx.from)) {
    throw new Error('LI.FI returned an incomplete transaction')
  }
  if (!sameAddress(tx.to, chain.lifiExecutor)) {
    throw new Error('LI.FI returned an unsupported transaction target')
  }
  if (!sameAddress(tx.from, intent.fromAddress)) {
    throw new Error('LI.FI returned the wrong transaction sender')
  }
  if (Number(tx.chainId) !== intent.fromChain) {
    throw new Error('LI.FI returned the wrong transaction chain')
  }
  if (!UINT.test(intent.toAmount) || BigInt(intent.toAmount) <= 0n) {
    throw new Error('The prepared zap amount is invalid')
  }

  const sourceAmount = parseInteger(quote.estimate?.fromAmount, 'source amount')
  if (sourceAmount !== BigInt(intent.toAmount)) {
    throw new Error('LI.FI changed the direct-source amount')
  }
  if (!sameAddress(quote.estimate?.approvalAddress, chain.lifiApproval)) {
    throw new Error('LI.FI returned an unsupported approval address')
  }
  const transactionValue = parseInteger(tx.value ?? '0', 'transaction value')
  if (transactionValue !== 0n) {
    throw new Error('A direct ERC-20 zap unexpectedly requested native value')
  }

  const decoded = decodeFunctionData({ abi: EXECUTOR_ABI, data: tx.data })
  if (decoded.functionName !== 'swapAndExecute') {
    throw new Error('LI.FI returned unsupported Executor calldata')
  }
  const [transactionId, swapData, transferredAssetId, receiver, amount] = decoded.args
  const canonical = encodeFunctionData({
    abi: EXECUTOR_ABI,
    functionName: 'swapAndExecute',
    args: [transactionId, swapData, transferredAssetId, receiver, amount],
  })
  if (canonical.toLowerCase() !== tx.data.toLowerCase()) {
    throw new Error('LI.FI returned non-canonical Executor calldata')
  }
  if (!sameAddress(transferredAssetId, intent.fromToken)) {
    throw new Error('LI.FI changed the transferred source token')
  }
  if (!sameAddress(receiver, intent.toFallbackAddress)) {
    throw new Error('LI.FI changed the refund receiver')
  }
  if (amount !== sourceAmount) {
    throw new Error('LI.FI changed the Executor source amount')
  }
  // A same-token direct quote must not contain an opaque LI.FI conversion
  // prefix. Every executor step has a locally authored counterpart below.
  if (swapData.length !== intent.contractCalls.length) {
    throw new Error('LI.FI added or removed a fixed-deposit call')
  }

  const introducedAssets = new Set<string>()
  for (let index = 0; index < intent.contractCalls.length; index += 1) {
    const expected = intent.contractCalls[index]
    const actual = swapData[index]
    const sendingAsset = getAddress(actual.sendingAssetId)
    const expectedRequiresDeposit = !introducedAssets.has(sendingAsset.toLowerCase())
    if (!sameAddress(actual.callTo, expected.toContractAddress)) {
      throw new Error(`LI.FI changed fixed-deposit call ${index + 1} target`)
    }
    if (!sameAddress(actual.approveTo, expected.toContractAddress)) {
      throw new Error(`LI.FI changed fixed-deposit call ${index + 1} approval target`)
    }
    if (!sameAddress(actual.sendingAssetId, expected.fromTokenAddress)) {
      throw new Error(`LI.FI changed fixed-deposit call ${index + 1} input token`)
    }
    if (!sameAddress(actual.receivingAssetId, expected.toTokenAddress)) {
      throw new Error(`LI.FI changed fixed-deposit call ${index + 1} output token`)
    }
    if (actual.fromAmount !== BigInt(expected.fromAmount)) {
      throw new Error(`LI.FI changed fixed-deposit call ${index + 1} amount`)
    }
    if (actual.callData.toLowerCase() !== expected.toContractCallData.toLowerCase()) {
      throw new Error(`LI.FI changed fixed-deposit call ${index + 1} calldata`)
    }
    if (actual.requiresDeposit !== expectedRequiresDeposit) {
      throw new Error(`LI.FI changed fixed-deposit call ${index + 1} funding semantics`)
    }
    introducedAssets.add(sendingAsset.toLowerCase())
    introducedAssets.add(getAddress(actual.receivingAssetId).toLowerCase())
  }

  return {
    sourceAmount,
    transactionValue,
    approvalAddress: getAddress(quote.estimate?.approvalAddress as Address),
    transaction: tx,
  }
}

export { EXECUTOR_ABI }
