import { getAddress, type Address, type Hash } from 'viem'

import { CHAINS } from '../chain/chains'
import { clientFor } from '../chain/clients'
import type { FixedVault } from '../fixedVaults/model'
import { ensureChain, walletClient, walletPublicClient } from '../wallet/wallet'

import { requestZapQuote } from './api'
import { ZAP_QUOTE_MAX_AGE_MS } from './config'
import type {
  PreparedZap,
  ZapExecutionResult,
  ZapExecutionStep,
  ZapQuote,
} from './types'
import { validateZapQuote } from './validate'

const ERC20_ABI = [
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ type: 'address' }, { type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'address' }, { type: 'uint256' }],
    outputs: [{ type: 'bool' }],
  },
] as const

function isFresh(receivedAt: number): boolean {
  const age = Date.now() - receivedAt
  return Number.isFinite(receivedAt) && receivedAt > 0 && age >= 0 && age <= ZAP_QUOTE_MAX_AGE_MS
}

function bufferedGas(estimate: bigint): bigint {
  // Match the fixed-income wallet flow's +20% ceiling without trusting a
  // caller-controlled gasLimit returned in the LI.FI response.
  return estimate + (estimate + 4n) / 5n
}

/** Submit one exact finite ERC-20 allowance and wait for its receipt. */
async function setAllowance({
  token,
  spender,
  amount,
  account,
  chain,
  onHash,
}: {
  token: Address
  spender: Address
  amount: bigint
  account: Address
  chain: (typeof CHAINS)[number]
  onHash?: (hash: Hash, amount: bigint) => void
}) {
  const wallet = walletClient()
  const reads = walletPublicClient(chain.chain)
  const hash = await wallet.writeContract({
    account,
    chain: chain.chain,
    address: token,
    abi: ERC20_ABI,
    functionName: 'approve',
    args: [spender, amount],
  })
  // Surface the amount alongside the hash so the UI can offer cleanup even if
  // the later quote refresh or preflight fails after this approval lands.
  onHash?.(hash, amount)
  const receipt = await reads.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('The token approval reverted')
}

/**
 * Execute the already reviewed route. Every mutable condition is re-read, the
 * quote is refreshed after an approval, and an `eth_call` preflight runs before
 * the wallet is asked to sign the final executor transaction.
 */
export async function executeZap({
  vault,
  account,
  prepared,
  quote,
  quoteReceivedAt,
  onStep,
  onApprovalHash,
  onZapHash,
}: {
  vault: FixedVault
  account: Address
  prepared: PreparedZap
  quote: ZapQuote
  quoteReceivedAt: number
  onStep: (step: ZapExecutionStep) => void
  onApprovalHash?: (hash: Hash, amount: bigint) => void
  onZapHash?: (hash: Hash) => void
}): Promise<ZapExecutionResult> {
  const chain = CHAINS.find((candidate) => candidate.chain.id === vault.chainId)
  if (!chain) throw new Error(`Unknown chain ${vault.chainId}`)
  await ensureChain(chain.chain)
  const connectedChainId = await walletClient().getChainId()
  if (connectedChainId !== vault.chainId) {
    throw new Error(`Wallet is connected to chain ${connectedChainId}, expected ${vault.chainId}`)
  }

  onStep('checking')
  let activeQuote = quote
  let activeReceivedAt = quoteReceivedAt
  if (!isFresh(activeReceivedAt)) {
    throw new Error('This zap quote expired. Refresh it before continuing.')
  }
  let validated = validateZapQuote(prepared.request, activeQuote)
  const walletReads = walletPublicClient(chain.chain)
  const readClient = clientFor(vault.chainKey)
  if (!readClient) throw new Error(`${vault.chainLabel} RPC is unavailable`)
  const claimToken = prepared.request.contractOutputsToken
  const [balance, allowance, claimBalanceBefore] = await Promise.all([
    walletReads.readContract({
      address: prepared.plan.deliverToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account],
    }),
    walletReads.readContract({
      address: prepared.plan.deliverToken,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account, validated.approvalAddress],
    }),
    walletReads.readContract({
      address: claimToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account],
    }),
  ])
  if (balance < validated.sourceAmount) {
    throw new Error(`Insufficient ${prepared.deliverTokenSymbol} balance for this zap`)
  }

  if (allowance < validated.sourceAmount) {
    // USDT-family tokens reject nonzero-to-nonzero approvals. Reset a smaller
    // existing allowance explicitly, then approve only the reviewed amount.
    if (allowance > 0n) {
      onStep('resetting-allowance')
      await setAllowance({
        token: prepared.plan.deliverToken,
        spender: validated.approvalAddress,
        amount: 0n,
        account,
        chain,
        onHash: onApprovalHash,
      })
    }
    onStep('approving')
    await setAllowance({
      token: prepared.plan.deliverToken,
      spender: validated.approvalAddress,
      amount: validated.sourceAmount,
      account,
      chain,
      onHash: onApprovalHash,
    })
    // Wallet confirmation can outlive the 30-second LI.FI envelope. Refresh
    // the exact same local call plan, then bind the new response again.
    onStep('refreshing-quote')
    activeQuote = await requestZapQuote(prepared.request)
    activeReceivedAt = Date.now()
    validated = validateZapQuote(prepared.request, activeQuote)
  }
  if (!isFresh(activeReceivedAt)) {
    throw new Error('The refreshed zap quote expired before submission')
  }

  onStep('simulating')
  const to = getAddress(validated.transaction.to)
  const transaction = {
    account,
    to,
    data: validated.transaction.data,
    value: validated.transactionValue,
  } as const
  // The app-owned read RPC performs an independent call simulation. The wallet
  // provider then estimates gas because the read-only proxy deliberately does
  // not expose eth_estimateGas.
  await readClient.call(transaction)
  const gas = bufferedGas(await walletReads.estimateGas(transaction))

  onStep('sending')
  const hash = await walletClient().sendTransaction({
    ...transaction,
    chain: chain.chain,
    gas,
  })
  onZapHash?.(hash)
  onStep('confirming')
  const receipt = await walletReads.waitForTransactionReceipt({ hash })
  if (receipt.status !== 'success') throw new Error('The LI.FI zap transaction reverted')

  const [claimBalanceAfter, leftoverAllowance] = await Promise.all([
    walletReads.readContract({
      address: claimToken,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [account],
    }),
    walletReads.readContract({
      address: prepared.plan.deliverToken,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [account, validated.approvalAddress],
    }),
  ])
  return {
    hash,
    leftoverAllowance,
    positionObserved: claimBalanceAfter > claimBalanceBefore,
  }
}

/** Optional post-success cleanup for a pre-existing or rounded allowance. */
export async function revokeZapAllowance({
  vault,
  account,
  token,
  spender,
  onHash,
}: {
  vault: FixedVault
  account: Address
  token: Address
  spender: Address
  onHash?: (hash: Hash) => void
}): Promise<Hash> {
  const chain = CHAINS.find((candidate) => candidate.chain.id === vault.chainId)
  if (!chain) throw new Error(`Unknown chain ${vault.chainId}`)
  await ensureChain(chain.chain)
  let finalHash: Hash | undefined
  await setAllowance({
    token,
    spender,
    amount: 0n,
    account,
    chain,
    onHash: (hash) => {
      finalHash = hash
      onHash?.(hash)
    },
  })
  if (!finalHash) throw new Error('Allowance revocation was not submitted')
  return finalHash
}
