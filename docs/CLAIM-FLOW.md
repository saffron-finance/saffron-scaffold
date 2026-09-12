# Creation request and LP deposit confirmation

## Approved presentation

The amount and review screens show token logos and `Deposit CASHCAT/ETH, get $X`.
Review uses `Claim $X`; X is the request-time USD value of the committed token
premium, not LP principal or the $2 fee. The title amount is green; the button
amount is white. Token values truncate exact decimal strings, not rounded floats.

Back returns to the amount without clearing a submitted payment. The first
review bullet has an LP tooltip accessible by hover, keyboard or tap. LP details
is collapsed initially. The lock-time bullet is last. No public capacity figures,
minimum-deposit policy or remaining-capacity helper appears in either modal.

The claim action requests a vault; it does not deposit LP or immediately transfer
a reward. The text states `Creation fee: $2 in ETH plus gas.` The operator funds
the premium separately. The user confirms actual LP amounts before deposit.
Full-range liquidity does not eliminate price risk or impermanent loss.

## Preview versus API mode

The default and lab builds simulate requests in browser storage. They have no
payment deadline or wallet access. Sample C06 states are not chain evidence.

The explicit live build uses the canonical hooks from `19ad0e9`. Its backend
stores a quote-bound ETH fee and verifies the payer, recipient, exact amount,
calldata, chain, successful receipt and canonical confirmations. A payment cannot
fund two requests. Lost responses recover the original request without a second
fee. One wallet can make any number of separately paid requests.

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
Refunds, if required, are processed manually outside this frontend.
