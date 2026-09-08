import { decodeFunctionData, erc20Abi, keccak256, stringToHex, type Address, type Hash,
  type Transaction, type TransactionReceipt } from 'viem'
import { arbitrum } from 'viem/chains'
import { assertWalletAccount, ensureChain, walletClient } from '@lab/wallet/wallet'
import { REQUEST_PAYMENT, requestMessage, validAddress, validRequestPayment, type PaidRequest } from '@receipt'
import { arbitrumClient, requestJson } from './transport'

export type FeeAsset = 'USDC' | 'ETH'
export type PaymentConfig = typeof REQUEST_PAYMENT & { enabled: boolean; recipient: Address | null;
  ethAvailable: boolean; ethUsdRaw: string | null; ethAmountRaw: string | null; ethPriceUpdatedAt: number | null }
export interface FeeQuote { id: string; wallet: Address; recipient: Address; asset: FeeAsset; amountRaw: string; expiresAt: string }
export interface PaymentBalances { USDC?: bigint; ETH?: bigint; error?: string }
export class PaymentRevertedError extends Error {}
const transferTopic = keccak256(stringToHex('Transfer(address,address,uint256)'))
const same = (a: unknown, b: string) => typeof a === 'string' && a.toLowerCase() === b.toLowerCase()

/** Fail closed if the host changes the reviewed chain, token, or fixed USD fee. */
export async function loadPaymentConfig(): Promise<PaymentConfig> {
  const value = await requestJson('/config')
  if (!value || Object.entries(REQUEST_PAYMENT).some(([key, expected]) => value[key] !== expected)
    || typeof value.enabled !== 'boolean' || (value.enabled && !validAddress(value.recipient))
    || (value.recipient !== null && !validAddress(value.recipient))
    || typeof value.ethAvailable !== 'boolean'
    || (value.ethAvailable && (typeof value.ethUsdRaw !== 'string' || !/^[1-9]\d{0,30}$/.test(value.ethUsdRaw)
      || typeof value.ethAmountRaw !== 'string' || !/^[1-9]\d{0,77}$/.test(value.ethAmountRaw)
      || !Number.isFinite(value.ethPriceUpdatedAt) || value.ethPriceUpdatedAt <= 0
      || value.ethPriceUpdatedAt > Date.now() + 60_000 || Date.now() - value.ethPriceUpdatedAt > 3_600_000))) {
    throw new Error('Payment configuration is invalid. No payment was sent.')
  }
  if (value.ethAvailable) {
    const price = BigInt(value.ethUsdRaw)
    if (BigInt(value.ethAmountRaw) !== (200_000_000n * 10n ** 18n + price - 1n) / price) {
      throw new Error('ETH fee does not match its USD quote. No payment was sent.')
    }
  }
  return value
}

/** Both balances always come from Arbitrum, not the wallet's selected network. */
export async function loadPaymentBalances(account: Address): Promise<PaymentBalances> {
  const [usdc, eth] = await Promise.allSettled([
    arbitrumClient.readContract({ address: REQUEST_PAYMENT.token, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    arbitrumClient.getBalance({ address: account }),
  ])
  return { USDC: usdc.status === 'fulfilled' ? usdc.value : undefined,
    ETH: eth.status === 'fulfilled' ? eth.value : undefined,
    ...(usdc.status === 'rejected' || eth.status === 'rejected' ? { error: 'Some Arbitrum balances could not be loaded. Refresh to retry.' } : {}) }
}

/** Oracle USD has 8 decimals; USDC has 6 and native ETH has 18. */
export function preferredFeeAsset(balances: PaymentBalances, ethUsdRaw: string | null): FeeAsset {
  if (balances.ETH === undefined || balances.USDC === undefined || !ethUsdRaw || !/^[1-9]\d*$/.test(ethUsdRaw)) return 'USDC'
  return balances.ETH * BigInt(ethUsdRaw) > balances.USDC * 10n ** 20n ? 'ETH' : 'USDC'
}

/** Use the existing durable server quote so retries preserve the exact fee. */
export async function quoteRequestPayment(account: Address, asset: FeeAsset): Promise<FeeQuote> {
  const value = await requestJson('/quote', { wallet: account, asset })
  if (!value || !validRequestPayment({ asset: value.asset, amountRaw: value.amountRaw, quoteId: value.id })
    || value.asset !== asset || !same(value.wallet, account) || !validAddress(value.recipient)
    || (asset === 'USDC' && value.amountRaw !== '2000000')
    || !Number.isFinite(Date.parse(value.expiresAt)) || Date.parse(value.expiresAt) <= Date.now()) {
    throw new Error('Invalid payment quote. No payment was sent.')
  }
  return value
}

/** Send only native ETH or an exact 2 USDC transfer: no allowance or LP deposit. */
export async function payRequest(account: Address, recipient: Address, quote?: FeeQuote): Promise<Hash> {
  await ensureChain(arbitrum)
  await assertWalletAccount(account)
  const asset = quote?.asset ?? 'USDC', amount = BigInt(quote?.amountRaw ?? '2000000')
  if (quote && (!validRequestPayment({ asset: quote.asset, amountRaw: quote.amountRaw, quoteId: quote.id })
    || !same(quote.wallet, account) || !same(quote.recipient, recipient)
    || !Number.isFinite(Date.parse(quote.expiresAt)) || Date.parse(quote.expiresAt) <= Date.now())) {
    throw new Error('Payment quote expired or changed. Retry to refresh it.')
  }
  const balances = await loadPaymentBalances(account)
  if (balances[asset] === undefined || balances.ETH === undefined) throw new Error('Payment balance unavailable. Refresh and retry.')
  if (balances[asset]! < amount) throw new Error(`Insufficient ${asset} balance for the request fee.`)
  if (balances.ETH <= (asset === 'ETH' ? amount : 0n)) throw new Error('Keep ETH available for Arbitrum network gas.')
  // Balance/network reads can take time; check expiry again at the write boundary.
  if (quote && Date.parse(quote.expiresAt) <= Date.now()) throw new Error('Payment quote expired. Retry to refresh it.')
  await assertWalletAccount(account)
  if (asset === 'ETH') return walletClient().sendTransaction({ account, chain: arbitrum, to: recipient, value: amount })
  if (amount !== 2_000_000n) throw new Error('Invalid USDC fee. No payment was sent.')
  return walletClient().writeContract({ account, chain: arbitrum, address: REQUEST_PAYMENT.token,
    abi: erc20Abi, functionName: 'transfer', args: [recipient, amount] })
}

/** Validate mined evidence before signing, including a speed-up's replacement hash.
 * A successful cancellation is not a payment. The backend independently repeats
 * these checks and remains authoritative about confirmation, quote and storage.
 */
export function assertPaymentEvidence(pending: PaidRequest, tx: Transaction, receipt: TransactionReceipt): void {
  if (!same(tx.hash, receipt.transactionHash) || !same(tx.from, pending.wallet)
    || !same(tx.blockHash, receipt.blockHash) || tx.blockNumber !== receipt.blockNumber) {
    throw new Error('Payment receipt does not match this wallet. Keep the original receipt and retry.')
  }
  if (pending.payment?.asset === 'ETH') {
    if (!same(tx.to, pending.recipient) || tx.value !== BigInt(pending.payment.amountRaw) || !['', '0x'].includes(tx.input)) {
      throw new Error('Replacement transaction is not the quoted ETH fee. No request was signed.')
    }
    return
  }
  if (!same(tx.to, REQUEST_PAYMENT.token) || tx.value !== 0n || tx.input.length !== 138) throw new Error('Transaction is not the exact USDC request fee.')
  const call = decodeFunctionData({ abi: erc20Abi, data: tx.input })
  if (call.functionName !== 'transfer' || !same(call.args[0], pending.recipient) || call.args[1] !== 2_000_000n) {
    throw new Error('Transaction is not the exact USDC request fee.')
  }
  const topicAddress = (topic: unknown, address: Address) => same(topic, `0x${'0'.repeat(24)}${address.slice(2)}`)
  if (!receipt.logs.some((log) => !log.removed && same(log.address, REQUEST_PAYMENT.token)
    && log.topics.length === 3 && same(log.topics[0], transferTopic)
    && topicAddress(log.topics[1], pending.wallet) && topicAddress(log.topics[2], pending.recipient)
    && /^0x[0-9a-fA-F]{64}$/.test(log.data) && BigInt(log.data) === 2_000_000n)) {
    throw new Error('Confirmed USDC transfer event was not found.')
  }
}

/** Return the canonical successful hash; never discard a hash on RPC uncertainty. */
export async function confirmPayment(pending: PaidRequest, rememberHash?: (hash: Hash) => void): Promise<Hash> {
  if (await arbitrumClient.getChainId() !== REQUEST_PAYMENT.chainId) throw new Error('Payment RPC is on the wrong network.')
  const receipt = await arbitrumClient.waitForTransactionReceipt({ hash: pending.paymentTxHash, confirmations: 2, timeout: 90_000 })
  // Persist a resolved replacement even if the next RPC read fails. Keeping the
  // old, now-dropped hash would make recovery after a reload impossible.
  if (!same(receipt.transactionHash, pending.paymentTxHash)) rememberHash?.(receipt.transactionHash)
  if (receipt.status === 'reverted') throw new PaymentRevertedError('The payment reverted. No request fee was collected; network gas may have been spent.')
  if (receipt.status !== 'success') throw new Error('Payment status is unknown. Keep this payment hash and retry.')
  const tx = await arbitrumClient.getTransaction({ hash: receipt.transactionHash })
  assertPaymentEvidence(pending, tx, receipt)
  return receipt.transactionHash
}

/** Sign the canonical request envelope, preserving old receipt formats exactly. */
export async function signRequest(pending: PaidRequest): Promise<`0x${string}`> {
  await assertWalletAccount(pending.wallet)
  return walletClient().signMessage({ account: pending.wallet, message: requestMessage(pending) })
}

/** Idempotent host API: identical retries yield the original queue ID. */
export async function saveRequest(pending: PaidRequest): Promise<{ id: string; status: string }> {
  const value = await requestJson('', pending)
  if (typeof value.id !== 'string' || value.status !== 'paid_waiting_for_vault') throw new Error('Queue response was invalid. Retry without paying again.')
  return value
}
