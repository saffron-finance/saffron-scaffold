# Creation request and LP deposit confirmation

## Approved presentation

The amount and review screens show token logos and `Deposit CASHCAT/ETH, get $X`.
Review uses `Claim $X`; X is the request-time USD value of the committed token
premium, not LP principal or the fixed ETH fee. The title amount is green; the button
amount is white. Token values truncate exact decimal strings, not rounded floats.

Back returns to the amount without clearing a submitted payment. The first
review bullet has an LP tooltip accessible by hover, keyboard or tap. LP details
is collapsed initially. The lock-time bullet is last. No public capacity figures,
minimum-deposit policy or remaining-capacity helper appears in either modal.

The claim action requests a vault; it does not deposit LP or immediately transfer
a reward. The text states `Request fee: <campaign amount> ETH, plus wallet network gas.` The operator funds
the premium separately. The user confirms actual LP amounts before deposit.
Full-range liquidity does not eliminate price risk or impermanent loss.

## One wallet/API path

Default, lab and live builds use the same canonical hooks. Local-chain tests
connect a real generated wallet to disposable contracts; production connects
an actual wallet to Robinhood Chain. There is no wallet-free runtime.

Each program stores a positive fixed `requestFeeWei`, entered in ETH by the
operator. The backend freezes that fee in each quote and verifies payer,
recipient, exact amount, calldata, chain, receipt and canonical confirmations.
No ETH/USD fee conversion occurs. Changing a campaign fee affects new quotes
only, not existing payments or refunds. One fee cannot fund two requests.

The backend still has a payment-quote deadline. The approved modal has no running
countdown, but live validation can show an expiry error before payment. Use Back
for a fresh unpaid quote. Removing a frontend timer does not remove backend
payment validity. A submitted payment keeps its recovery record, including when
it needs operator attention; do not request another payment for the same request.

## After creation

C06 reads shared API/database and chain-derived state in live mode. It retains
last known progress if verification fails and blocks dependent actions until
verification returns. Portfolio resumes the same saved request or owned position.

Deposit confirmation refreshes actual LP quantities and value. The user explicitly
wraps/approves/deposits as required, then claims after the vault starts. Start and
maturity dates come from verified observations. Current bearer ownership controls
position actions; request ownership alone does not grant withdrawal rights.

No C05 tracker, refund request or requester-retirement workflow is present.
Operators pay refunds externally and use Administration to verify them.
