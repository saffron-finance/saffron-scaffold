// Public payment constants. Only the operator-selected receiving address is
// configurable; browser input can never select another token, fee, or chain.
export const REQUEST_PAYMENT = Object.freeze({
  chainId: 42161,
  chainLabel: 'Arbitrum',
  token: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  tokenSymbol: 'USDC',
  tokenDecimals: 6,
  amount: '2',
})

/** Validate bounded, positive request details before a wallet can be charged. */
export function validDetails(value) {
  if (value?.version !== undefined && value.version !== 3) return false
  const basic = Boolean(value && ['ethereum', 'arbitrum', 'robinhood'].includes(value.chain)
    && [value.depositToken, value.pair].every((text) => typeof text === 'string'
      && text.trim().length > 0 && text.length <= 80 && !/[\u0000-\u001f\u007f]/.test(text))
    && typeof value.depositAmount === 'string' && value.depositAmount.length <= 50
    && /^\d+(\.\d+)?$/.test(value.depositAmount) && /[1-9]/.test(value.depositAmount))
  if (!basic) return false
  // Retain the exact v1 contract for existing general requests and paid retries.
  if (value.kind === undefined) return value.incentive === undefined
  if (value.kind !== 'incentive') return false
  const t = value.incentive
  const positive = (n) => typeof n === 'number' && Number.isFinite(n) && n > 0 && n <= 1e30
  const token = (t) => t && validAddress(t.address) && Number.isInteger(t.decimals)
    && t.decimals >= 0 && t.decimals <= 18 && typeof t.symbol === 'string'
    && /^[A-Za-z0-9._-]{1,20}$/.test(t.symbol)
  return Boolean(t && typeof t.id === 'string' && /^[a-z0-9-]{1,80}$/.test(t.id)
    && value.chain === 'robinhood' && t.chainId === 4663 && validAddress(t.poolAddress)
    && token(t.token0) && token(t.token1) && t.token0.address.toLowerCase() !== t.token1.address.toLowerCase()
    && value.pair === `${t.token0.symbol} / ${t.token1.symbol}` && value.depositToken === 'USD'
    && t.depositUsd === value.depositAmount && positive(Number(t.depositUsd))
    && Number.isInteger(t.durationDays) && t.durationDays > 0 && t.durationDays <= 3650
    && positive(t.capacityUsd) && Number(t.depositUsd) <= t.capacityUsd
    && positive(t.aprPercent) && t.aprPercent <= 100000
    && (value.version === 3 ? t.slippageBps === undefined && [100, 500, 3000, 10000].includes(t.feeTier) : [10, 50, 100].includes(t.slippageBps))
    && t.range === 'full' && t.quote
    && ['cashcatAmount', 'quoteAmount', 'rewardUsd', 'rewardCashcat', 'cashcatUsd', 'quoteTokenUsd', 'quotePerCashcat'].every((key) => positive(t.quote[key]))
    && typeof t.quote.quotedAt === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(t.quote.quotedAt)
    && Number.isFinite(Date.parse(t.quote.quotedAt)))
}

/** Copy only supported fields in fixed order: the stored terms are exactly signed. */
export function canonicalIncentive(t) {
  const token = (v) => ({ address: v.address.toLowerCase(), symbol: v.symbol, decimals: v.decimals })
  return { id: t.id, chainId: t.chainId, poolAddress: t.poolAddress.toLowerCase(),
    ...(t.feeTier === undefined ? {} : { feeTier: t.feeTier }),
    token0: token(t.token0), token1: token(t.token1), durationDays: t.durationDays,
    capacityUsd: t.capacityUsd, aprPercent: t.aprPercent, depositUsd: t.depositUsd,
    ...(t.slippageBps === undefined ? {} : { slippageBps: t.slippageBps }), range: t.range,
    quote: { cashcatAmount: t.quote.cashcatAmount, quoteAmount: t.quote.quoteAmount,
      rewardUsd: t.quote.rewardUsd, rewardCashcat: t.quote.rewardCashcat,
      cashcatUsd: t.quote.cashcatUsd, quoteTokenUsd: t.quote.quoteTokenUsd,
      quotePerCashcat: t.quote.quotePerCashcat, quotedAt: t.quote.quotedAt } }
}

/** Version 3 binds the selected native/ERC-20 fee and server-issued quote. */
export function validRequestPayment(value) {
  return Boolean(value && ['USDC', 'ETH'].includes(value.asset)
    && typeof value.amountRaw === 'string' && /^[1-9]\d{0,77}$/.test(value.amountRaw)
    && typeof value.quoteId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.quoteId))
}

/** Check addresses structurally without imposing a mixed-case checksum. */
export function validAddress(value) {
  return typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    && !/^0x0{40}$/i.test(value)
}

/** Canonical signed fields bind this payer's payment to these request details. */
export function requestMessage(value) {
  if (value.version === 3) return [
    'Saffron / LiqiFi vault request v3',
    'This signature records a request. It does not authorize another payment.',
    `Wallet: ${value.wallet.toLowerCase()}`, `Payment chain: ${REQUEST_PAYMENT.chainId}`,
    `Payment asset: ${value.payment.asset}`, `Payment amount (smallest units): ${value.payment.amountRaw}`,
    `Payment quote: ${value.payment.quoteId}`, `Recipient: ${value.recipient.toLowerCase()}`,
    `Payment transaction: ${value.paymentTxHash.toLowerCase()}`,
    `Requested network: ${value.chain}`, `Deposit token: ${value.depositToken.trim()}`,
    `Desired pair: ${value.pair.trim()}`, `Deposit amount: ${value.depositAmount}`,
    ...(value.kind === 'incentive' ? [
      `Duration: ${value.incentive.durationDays} days`, `Vault capacity: ${value.incentive.capacityUsd} USD`,
      `APR: ${value.incentive.aprPercent}%`,
      `Complete incentive terms: ${JSON.stringify(canonicalIncentive(value.incentive))}`,
    ] : []),
  ].join('\n')
  return [
    value.kind === 'incentive' ? 'Saffron / LiqiFi incentive vault request v2' : 'Saffron / LiqiFi vault request v1',
    'This signature records a request. It does not authorize another payment.',
    `Wallet: ${value.wallet.toLowerCase()}`,
    `Payment chain: ${REQUEST_PAYMENT.chainId}`,
    `Payment token: ${REQUEST_PAYMENT.token.toLowerCase()}`,
    `Payment amount: ${REQUEST_PAYMENT.amount} USDC`,
    `Recipient: ${value.recipient.toLowerCase()}`,
    `Payment transaction: ${value.paymentTxHash.toLowerCase()}`,
    `Requested network: ${value.chain}`,
    `Deposit token: ${value.depositToken.trim()}`,
    `Desired pair: ${value.pair.trim()}`,
    `Deposit amount: ${value.depositAmount}`,
    ...(value.kind === 'incentive' ? [
      'Request type: incentive; deposit amount is USD, not a token transfer.',
      // Explicit labels make the economically important terms readable in a wallet.
      `Duration: ${value.incentive.durationDays} days`,
      `Vault capacity: ${value.incentive.capacityUsd} USD`,
      `APR: ${value.incentive.aprPercent}%`,
      `Slippage: ${value.incentive.slippageBps} bps`,
      `Complete incentive terms: ${JSON.stringify(canonicalIncentive(value.incentive))}`,
    ] : []),
  ].join('\n')
}
