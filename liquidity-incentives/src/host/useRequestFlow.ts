import { useEffect, useRef, useState } from 'react'
import { formatUnits, type Address, type Hash } from 'viem'
import { validDetails, type PaidRequest, type RequestDetails } from '@receipt'
import { confirmPayment, loadPaymentConfig, loadPaymentBalances, preferredFeeAsset, quoteRequestPayment, payRequest, saveRequest, signRequest, PaymentRevertedError, PaymentCancelledError, type PaymentConfig, type PaymentBalances, type FeeAsset } from './payment'
import { MAX_RECEIPT_BYTES, parseRequestReceipt, validPending } from './requestReceipt'

export const INCENTIVE_REQUEST_KEY = 'liqifi.pending-incentive-request.v1'

/** Stored browser data is a recovery hint only; the server still verifies it. */
export function readPendingRequest(): PaidRequest | null {
  try {
    const value = JSON.parse(localStorage.getItem(INCENTIVE_REQUEST_KEY) || 'null')
    return validPending(value) ? value : null
  } catch { return null }
}

/**
 * Host-only recovery adapter. Keep this hook above the modal boundary so
 * closing a dialog cannot drop a broadcast hash or reset the double-click guard.
 * The storage key and envelope are shared with the original LiqiFi page.
 */
export function useRequestFlow(account: Address | null, onConnect: () => void) {
  const [pending, setPending] = useState<PaidRequest | null>(() => readPendingRequest())
  const [config, setConfig] = useState<PaymentConfig | null>(null)
  const [step, setStep] = useState<'idle' | 'paying' | 'confirming' | 'signing' | 'saving' | 'done'>('idle')
  const [error, setError] = useState<string | null>(null)
  const [storageWarning, setStorageWarning] = useState(false)
  const [requestId, setRequestId] = useState<string | null>(null)
  const [confirmedFailure, setConfirmedFailure] = useState<'reverted' | 'cancelled' | null>(null)
  const [asset, setAssetState] = useState<FeeAsset>('USDC')
  const [balances, setBalances] = useState<PaymentBalances>({})
  const [balanceAccount, setBalanceAccount] = useState<Address | null>(null)
  const [balanceLoading, setBalanceLoading] = useState(false)
  const [balanceRevision, setBalanceRevision] = useState(0)
  const manualSelection = useRef<string | null>(null)
  const inFlight = useRef(false)
  const currentFlow = useRef({ account, pending, step })
  currentFlow.current = { account, pending, step }
  const busy = !['idle', 'done'].includes(step)

  useEffect(() => {
    let cancelled = false
    void loadPaymentConfig().then((value) => { if (!cancelled) setConfig(value) })
      .catch((cause) => { if (!cancelled) setError(cause.message) })
    return () => { cancelled = true }
  }, [balanceRevision])

  // A new account resets manual preference, but never changes a paid receipt.
  useEffect(() => { manualSelection.current = null }, [account])

  useEffect(() => {
    if (!account) { setBalances({}); setBalanceAccount(null); setBalanceLoading(false); return }
    let cancelled = false
    setBalanceLoading(true)
    void loadPaymentBalances(account).then((value) => {
      if (cancelled) return
      setBalances(value); setBalanceAccount(account)
      if (!pending && manualSelection.current !== account.toLowerCase()) {
        setAssetState(config?.ethAvailable ? preferredFeeAsset(value, config.ethUsdRaw) : 'USDC')
      }
    }).catch(() => {
      if (!cancelled) { setBalances({ error: 'Arbitrum balances are unavailable. Refresh to retry.' }); setBalanceAccount(account) }
    }).finally(() => { if (!cancelled) setBalanceLoading(false) })
    return () => { cancelled = true }
  }, [account, config?.ethUsdRaw, config?.ethAvailable, balanceRevision])

  /** Respect a deliberate choice until the connected wallet changes. */
  function setAsset(value: FeeAsset) {
    if (inFlight.current || pending) return
    setAssetState(value); manualSelection.current = account?.toLowerCase() ?? null
  }

  /** Write the full immutable request immediately once the wallet returns a hash. */
  function remember(value: PaidRequest) {
    setPending(value)
    try { localStorage.setItem(INCENTIVE_REQUEST_KEY, JSON.stringify(value)); setStorageWarning(false) }
    catch { setStorageWarning(true) }
  }

  /** Import only restores review/recovery state; it never sends or signs. */
  async function importReceipt(file: File): Promise<PaidRequest> {
    if (inFlight.current) throw new Error('Finish the current action before importing a receipt.')
    inFlight.current = true
    try {
      if (file.size > MAX_RECEIPT_BYTES) throw new Error('Choose a request receipt no larger than 16 KB.')
      let text: string
      try { text = await file.text() }
      catch { throw new Error('The receipt file could not be read. Choose it again.') }
      const receipt = await parseRequestReceipt(text)
      // Read current state after asynchronous file/signature checks. Account
      // changes or an existing payment must never be lost to a stale callback.
      const current = currentFlow.current
      if ((current.pending && current.step !== 'done') || readPendingRequest()) {
        throw new Error('An unfinished request is already saved. Resume it before importing another receipt.')
      }
      if (current.account && current.account.toLowerCase() !== receipt.wallet.toLowerCase()) {
        throw new Error(`This receipt belongs to ${receipt.wallet}. Connect that wallet and import again.`)
      }
      setError(null); setRequestId(null); setConfirmedFailure(null); setStep('idle')
      manualSelection.current = null
      remember(receipt)
      return receipt
    } finally { inFlight.current = false }
  }

  /** Retry the same hash after a cancellation/timeout; never charge it again. */
  async function submit(details: RequestDetails, recoveryHash = '') {
    if (inFlight.current || step === 'done') return
    if (!account) { onConnect(); return }
    if (!pending && !validDetails(details)) { setError('Review valid request terms before continuing.'); return }
    // Deep-copy before the first await: later input/price changes cannot alter
    // the request reviewed when this button was pressed.
    const snapshot: RequestDetails = JSON.parse(JSON.stringify(details))
    inFlight.current = true
    setError(null); setConfirmedFailure(null)
    try {
      let payment = pending
      if (payment && payment.wallet.toLowerCase() !== account.toLowerCase()) {
        throw new Error('Reconnect the wallet that made this payment to resume its request.')
      }
      if (!payment) {
        // Hash-only recovery cannot reconstruct a v3 quote or legacy slippage
        // terms. An exported immutable receipt is the supported recovery input.
        if (recoveryHash.trim()) throw new Error('Import the saved request receipt to resume this payment without changing its terms.')
        if (Date.now() - Date.parse(snapshot.incentive!.quote.quotedAt) > 120_000) {
          throw new Error('The reviewed price is stale. Return to Deposit and refresh before requesting.')
        }
        setStep('paying')
        const current = await loadPaymentConfig()
        setConfig(current)
        if (!current.enabled || !current.recipient) throw new Error('Payment collection is not configured yet.')
        const quote = snapshot.version === 3 ? await quoteRequestPayment(account, asset, snapshot) : undefined
        if (quote && quote.recipient.toLowerCase() !== current.recipient.toLowerCase()) throw new Error('Fee recipient changed. Review and retry.')
        const hash = await payRequest(account, current.recipient, quote)
        payment = { ...snapshot, wallet: account, recipient: current.recipient, paymentTxHash: hash,
          ...(quote ? { payment: { asset: quote.asset, amountRaw: quote.amountRaw, quoteId: quote.id } } : {}) }
        remember(payment)
      }
      setStep('confirming')
      const updateHash = (canonicalHash: Hash) => {
        if (canonicalHash.toLowerCase() === payment!.paymentTxHash.toLowerCase()) return
        // A wallet speed-up changes the signed message. Persist the verified
        // replacement before asking for a new signature; never reuse an old one.
        payment = { ...payment!, paymentTxHash: canonicalHash }
        delete payment.signature
        remember(payment)
      }
      updateHash(await confirmPayment(payment, updateHash))
      if (!payment.signature) {
        setStep('signing')
        payment = { ...payment, signature: await signRequest(payment) }
        remember(payment)
      }
      setStep('saving')
      const saved = await saveRequest(payment)
      setRequestId(saved.id); setStep('done')
      window.dispatchEvent(new Event('liqifi:request-saved'))
      setBalanceRevision((value) => value + 1)
      try { localStorage.removeItem(INCENTIVE_REQUEST_KEY) } catch { /* Visible receipt remains available. */ }
    } catch (cause) {
      setConfirmedFailure(cause instanceof PaymentRevertedError ? 'reverted'
        : cause instanceof PaymentCancelledError ? 'cancelled' : null)
      const message = cause instanceof Error ? cause.message : String(cause)
      setError(/rejected|denied/i.test(message)
        ? 'Wallet action cancelled. If a payment hash is shown, resume it without paying again.'
        : message.split('\n')[0].slice(0, 240))
      setStep('idle')
    } finally { inFlight.current = false }
  }

  /** Only a proven unpaid transaction or a saved request may release its terms. */
  function clearFinished() {
    if (inFlight.current || (!confirmedFailure && step !== 'done')) return
    setPending(null); setRequestId(null); setConfirmedFailure(null); setError(null); setStep('idle')
    manualSelection.current = null
    setBalanceRevision((value) => value + 1)
    try { localStorage.removeItem(INCENTIVE_REQUEST_KEY) } catch { /* Clear current-session state. */ }
  }

  const selectedAsset = pending ? pending.payment?.asset ?? 'USDC' : asset
  const visibleBalances = account === balanceAccount ? balances : {}
  const amountRaw = pending?.payment?.amountRaw ?? (selectedAsset === 'ETH' ? config?.ethAmountRaw : '2000000')
  const canPay = Boolean(config?.enabled && amountRaw && visibleBalances[selectedAsset] !== undefined
    && visibleBalances[selectedAsset]! >= BigInt(amountRaw)
    && visibleBalances.ETH !== undefined && visibleBalances.ETH > (selectedAsset === 'ETH' ? BigInt(amountRaw) : 0n)
    && (selectedAsset !== 'ETH' || config.ethAvailable))
  const feeLabel = amountRaw ? `${formatUnits(BigInt(amountRaw), selectedAsset === 'ETH' ? 18 : 6)} ${selectedAsset}` : '≈ $2 in ETH'
  return { pending, config, step, error, storageWarning, requestId, confirmedFailure, busy, submit, clearFinished, importReceipt,
    selectedAsset, setAsset, balances: visibleBalances, balanceLoading: balanceLoading || Boolean(account && account !== balanceAccount),
    refreshBalances: () => setBalanceRevision((value) => value + 1), canPay, feeLabel }
}

export type RequestFlow = ReturnType<typeof useRequestFlow>
