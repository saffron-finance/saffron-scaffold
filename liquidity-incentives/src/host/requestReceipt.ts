import { verifyMessage } from 'viem'
import { requestMessage, validAddress, validDetails, validRequestPayment, type PaidRequest } from '@receipt'

export const MAX_RECEIPT_BYTES = 16_384

/** Accept current and legacy incentive receipts without rewriting signed terms. */
export function validPending(value: unknown): value is PaidRequest {
  if (!validDetails(value)) return false
  const payment = value as PaidRequest
  return validAddress(payment.wallet) && validAddress(payment.recipient)
    && typeof payment.paymentTxHash === 'string' && /^0x[0-9a-fA-F]{64}$/.test(payment.paymentTxHash)
    && payment.kind === 'incentive'
    && (payment.signature === undefined || (typeof payment.signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(payment.signature)))
    && (payment.version === 3 ? validRequestPayment(payment.payment)
      && (payment.payment!.asset !== 'USDC' || payment.payment!.amountRaw === '2000000') : payment.payment === undefined)
}

/** An imported file is recovery data. Payment is still checked when resuming. */
export async function parseRequestReceipt(text: string): Promise<PaidRequest> {
  if (new TextEncoder().encode(text).byteLength > MAX_RECEIPT_BYTES) {
    throw new Error('Choose a request receipt no larger than 16 KB.')
  }
  let value: unknown
  try { value = JSON.parse(text) }
  catch { throw new Error('This file is not valid JSON. Choose a saved request receipt.') }
  if (!validPending(value)) throw new Error('This file is not a supported incentive request receipt.')
  if (value.signature) {
    let verified = false
    try { verified = await verifyMessage({ address: value.wallet, message: requestMessage(value), signature: value.signature }) }
    catch { /* Invalid signatures must not replace recoverable browser state. */ }
    if (!verified) throw new Error('The receipt signature does not match its saved request. Choose the original receipt.')
  }
  return value
}
