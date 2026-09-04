import type { Address, Hash, Hex } from 'viem'

/** Networks whose direct-source LI.FI flow was verified in fixed-income. */
export type ZapSupportedChainId = 1 | 42161 | 4663

/** One destination call passed to LI.FI's contract-call quote endpoint. */
export interface ZapContractCall {
  fromAmount: string
  fromTokenAddress: Address
  toTokenAddress: Address
  toContractAddress: Address
  toContractCallData: Hex
  toContractGasLimit: string
}

/** Locally built and fully reviewable fixed-deposit call sequence. */
export interface ZapPlan {
  deliverToken: Address
  deliverAmount: bigint
  swapAmount: bigint
  calls: ZapContractCall[]
}

/**
 * Narrow request accepted by the local server-side LI.FI proxy.
 *
 * The source and destination chains/tokens intentionally match. This first
 * integration supports only the branch's fork-verified direct-source path;
 * arbitrary-token conversion and cross-chain routing stay out of scope.
 */
export interface ZapQuoteRequest {
  fromChain: ZapSupportedChainId
  fromToken: Address
  fromAddress: Address
  toChain: ZapSupportedChainId
  toToken: Address
  toAmount: string
  contractCalls: ZapContractCall[]
  contractOutputsToken: Address
  toFallbackAddress: Address
  slippage: number
}

export interface LifiTransactionRequest {
  from?: Address
  to: Address
  data: Hex
  value?: string
  gasLimit?: string
  chainId?: number | string
}

/** Subset of LI.FI's response consumed by the review and execution UI. */
export interface ZapQuote {
  id?: string
  estimate?: {
    approvalAddress?: Address
    fromAmount?: string
    fromAmountUSD?: string
    toAmount?: string
    toAmountMin?: string
    feeCosts?: Array<{ name?: string; amountUSD?: string; percentage?: string }>
    gasCosts?: Array<{ amountUSD?: string; estimate?: string }>
    executionDuration?: number
  }
  transactionRequest: LifiTransactionRequest
  includedSteps?: Array<{ type?: string; tool?: string }>
}

/** Values derived from fresh pool/vault reads before requesting a route. */
export interface PreparedZap {
  plan: ZapPlan
  request: ZapQuoteRequest
  deliverTokenSymbol: string
  deliverTokenDecimals: number
}

/** User-visible progress checkpoints for the bounded wallet flow. */
export type ZapExecutionStep =
  | 'checking'
  | 'resetting-allowance'
  | 'approving'
  | 'refreshing-quote'
  | 'simulating'
  | 'sending'
  | 'confirming'

export interface ZapExecutionResult {
  hash: Hash
  leftoverAllowance: bigint
  positionObserved: boolean
}
