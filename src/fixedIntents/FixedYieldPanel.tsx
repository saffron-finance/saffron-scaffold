import { useMemo, useState, type FormEvent } from 'react'
import {
  FIXED_INTENT_TERMS,
  formatMicros,
  fundingAmountToUsdMicros,
  maximumFixedCapacityMicros,
  parseUnsignedUnits,
  previewFixedIntent,
  type FundingCurrency,
} from './fixedIntentPreview'

interface FixedYieldPanelProps {
  account: string | null
  onConnect: () => void | Promise<void>
  /** GitHub Pages uses this path to demonstrate the flow without Web3. */
  previewOnly: boolean
}

interface StagedRequest {
  sourceAmount: string
  sourceCurrency: FundingCurrency
  fixedCapacityMicros: bigint
  variableYieldMicros: bigint
  wallet: string
}

/** Keep wallet identity readable while avoiding a large address in the card. */
function compactAddress(address: string): string {
  if (address === 'Non-Web3 preview') return address
  if (address.length <= 13) return address
  return `${address.slice(0, 7)}…${address.slice(-5)}`
}

/**
 * Render the first fixed-yield flow inside the standalone Saffron surface.
 *
 * Live builds connect to the injected wallet before staging the matched amount.
 * Static builds deliberately skip wallet access and retain the same deterministic
 * capacity calculations, making GitHub Pages safe and fully interactive.
 */
export function FixedYieldPanel({ account, onConnect, previewOnly }: FixedYieldPanelProps) {
  const [fundingCurrency, setFundingCurrency] = useState<FundingCurrency>('USDG')
  const [fundingAmount, setFundingAmount] = useState('10000')
  const [stagedRequest, setStagedRequest] = useState<StagedRequest | null>(null)

  const tokenDecimals = fundingCurrency === 'USDG' ? 6 : 18
  const parsedAmount = useMemo(
    () => parseUnsignedUnits(fundingAmount, tokenDecimals),
    [fundingAmount, tokenDecimals],
  )
  const malformedAmount = fundingAmount.trim().length > 0 && parsedAmount === undefined
  const requestedUsdMicros = parsedAmount
    ? fundingAmountToUsdMicros(parsedAmount, fundingCurrency)
    : 0n
  const match = previewFixedIntent(requestedUsdMicros)
  const maximumCapacity = maximumFixedCapacityMicros()

  /** Changing the funding asset resets values whose units no longer match. */
  function chooseFundingCurrency(currency: FundingCurrency) {
    setFundingCurrency(currency)
    setFundingAmount(currency === 'USDG' ? '10000' : '2.5')
    setStagedRequest(null)
  }

  /**
   * Stage the exact handoff shown in the reviewed fixed-intent implementation.
   * This step never moves funds; an executable LI.FI zap requires the admin to
   * create and link an exact-size vault first.
   */
  function stageMatchedRequest(event: FormEvent) {
    event.preventDefault()
    if (!parsedAmount || !match.matched) return

    // GitHub Pages uses an explicit demo identity rather than fabricating or
    // requesting a browser wallet address.
    const wallet = previewOnly ? 'Non-Web3 preview' : account
    if (!wallet) return

    setStagedRequest({
      sourceAmount: fundingAmount.replace(/,/g, '').trim(),
      sourceCurrency: fundingCurrency,
      fixedCapacityMicros: match.fixedUsdMicros,
      variableYieldMicros: match.requiredVariableYieldMicros,
      wallet,
    })
  }

  return (
    <div className="fixed-yield-flow">
      {previewOnly && (
        <div className="fixed-preview-banner">
          <span aria-hidden="true" />
          <p>
            <strong>Non-Web3 preview.</strong> Matching is local and no wallet, RPC, signature, or
            transaction is requested.
          </p>
        </div>
      )}

      <div className="fixed-flow-grid">
        <section className="fixed-card fixed-opportunity-card">
          <div className="fixed-card-eyebrow">Available match</div>
          <h3>Cash Cat</h3>
          <div className="fixed-pair-pill">{FIXED_INTENT_TERMS.pair}</div>
          <strong className="fixed-hero-apr">1,000%</strong>
          <div className="fixed-hero-label">fixed APR, 3 days</div>

          <div className="fixed-capacity-block">
            <div className="fixed-preview-row">
              <span>Fixed capacity available</span>
              <strong>${formatMicros(maximumCapacity, 2)}</strong>
            </div>
            <div className="fixed-capacity-track"><span /></div>
            <div className="fixed-preview-row fixed-capacity-foot">
              <span>Backed by</span>
              <strong>{formatMicros(FIXED_INTENT_TERMS.availableVariableYieldMicros)} USDG</strong>
            </div>
          </div>

          <dl className="fixed-definitions">
            <div><dt>Network</dt><dd>{FIXED_INTENT_TERMS.network}</dd></div>
            <div><dt>Pool fee</dt><dd>{FIXED_INTENT_TERMS.feeTierLabel}</dd></div>
            <div>
              <dt>Range</dt>
              <dd>{FIXED_INTENT_TERMS.minTick.toLocaleString()} to {FIXED_INTENT_TERMS.maxTick.toLocaleString()}</dd>
            </div>
          </dl>
          <p className="fixed-neutral-note">APR, duration, pair, and range are fixed for this process.</p>
        </section>

        <form className="fixed-card fixed-request-card" onSubmit={stageMatchedRequest}>
          <div>
            <h3>How much do you have?</h3>
            <p className="fixed-card-copy">
              This is your maximum one-asset budget. LI.FI later converts it into the exact
              CASHCAT/WETH fixed deposit.
            </p>
          </div>

          <fieldset className="fixed-fieldset">
            <legend>Pay with</legend>
            <div className="fixed-currency-grid">
              {(['USDG', 'ETH'] as FundingCurrency[]).map((currency) => (
                <button
                  key={currency}
                  type="button"
                  className={fundingCurrency === currency ? 'selected' : ''}
                  aria-pressed={fundingCurrency === currency}
                  onClick={() => chooseFundingCurrency(currency)}
                >
                  <span>{currency === 'ETH' ? 'Ξ' : '$'}</span>{currency}
                </button>
              ))}
            </div>
          </fieldset>

          <label className="fixed-amount-field" htmlFor="fixed-intent-source-amount">
            <span>I have</span>
            <span className={`fixed-amount-control ${malformedAmount ? 'invalid' : ''}`}>
              <input
                id="fixed-intent-source-amount"
                type="text"
                inputMode="decimal"
                autoComplete="off"
                value={fundingAmount}
                aria-invalid={malformedAmount}
                onChange={(event) => {
                  setFundingAmount(event.target.value)
                  setStagedRequest(null)
                }}
              />
              <b>{fundingCurrency}</b>
            </span>
            <small>
              {malformedAmount
                ? `Enter a positive ${fundingCurrency} amount with no more than ${tokenDecimals} decimals.`
                : fundingCurrency === 'ETH'
                  ? 'Previewed at $4,000 per ETH. LI.FI supplies the executable quote after vault creation.'
                  : 'USDG is valued at $1.00 for this amount match.'}
            </small>
          </label>

          {match.fixedUsdMicros > 0n && (
            <div className={`fixed-match-panel ${match.matched ? 'matched' : 'unmatched'}`} aria-live="polite">
              <div className="fixed-match-headline">
                <strong>{match.matched ? 'Immediate match available' : 'Above capacity'}</strong>
                <span>{match.matched ? 'Matched' : 'No match'}</span>
              </div>
              <div className="fixed-preview-row">
                <span>Exact vault capacity</span>
                <strong>${formatMicros(match.fixedUsdMicros, 2)}</strong>
              </div>
              <div className="fixed-preview-row">
                <span>Variable yield allocated</span>
                <strong>{formatMicros(match.requiredVariableYieldMicros)} USDG</strong>
              </div>
              {match.matched && (
                <div className="fixed-preview-row">
                  <span>Variable yield left in pool</span>
                  <strong>{formatMicros(match.remainingVariableYieldMicros)} USDG</strong>
                </div>
              )}
            </div>
          )}

          {!previewOnly && account && (
            <div className="fixed-wallet-line">
              <span>Staging as</span><strong>{compactAddress(account)}</strong>
            </div>
          )}

          {previewOnly || account ? (
            <button className="fixed-primary-button" type="submit" disabled={!parsedAmount || !match.matched}>
              {previewOnly ? 'Preview matched request' : 'Stage matched request'}
            </button>
          ) : (
            <button className="fixed-primary-button" type="button" onClick={() => void onConnect()}>
              Connect wallet
            </button>
          )}
          <p className="fixed-action-help">
            Nothing moves now. The final LI.FI zap unlocks only after an admin creates the exact vault.
          </p>
        </form>
      </div>

      {stagedRequest && (
        <section className="fixed-staged-card" aria-live="polite">
          <div className="fixed-staged-head">
            <div><span>Review state</span><h3>Amount matched, awaiting vault</h3></div>
            <b>{previewOnly ? 'Preview' : 'Admin queue'}</b>
          </div>
          <div className="fixed-staged-grid">
            <div><span>Source budget</span><strong>{stagedRequest.sourceAmount} {stagedRequest.sourceCurrency}</strong></div>
            <div><span>Fixed capacity</span><strong>${formatMicros(stagedRequest.fixedCapacityMicros, 2)}</strong></div>
            <div><span>Variable allocation</span><strong>{formatMicros(stagedRequest.variableYieldMicros)} USDG</strong></div>
            <div><span>Wallet</span><strong>{compactAddress(stagedRequest.wallet)}</strong></div>
          </div>
          <button type="button" disabled>LI.FI zap unlocks after the exact vault is created</button>
        </section>
      )}

      <section className="fixed-process-card">
        <h3>What happens next</h3>
        <ol>
          <li><b>01</b><div><strong>Amount matched</strong><p>Your capacity is checked against the available USDG premium.</p></div></li>
          <li><b>02</b><div><strong>Admin creates your vault</strong><p>The frozen Cash Cat terms and exact capacities arrive prefilled.</p></div></li>
          <li><b>03</b><div><strong>Zap into fixed yield</strong><p>LI.FI routes ETH or USDG into CASHCAT and WETH for the deposit.</p></div></li>
        </ol>
      </section>
    </div>
  )
}
