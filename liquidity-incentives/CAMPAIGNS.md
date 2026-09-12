# Campaign planning and ETH-paid creation

Current product specification. See [IMPLEMENTATION.md](IMPLEMENTATION.md) for
storage and [ops/README.md](ops/README.md) for deployment procedures.

## Responsibilities

The application defines incentive terms, verifies canonical $2 ETH payments,
creates matching vaults, observes vault funding, and exposes user LP actions.
The isolated creator pays creation gas and never funds premiums. External
funders deposit premiums and own the variable-side bearer rights. Users make
ordinary wallet payments and LP transactions, without a message-login step.
Only allowlisted operators use message authentication for administration.

## Campaign calculator

Enter duration in days and two of planning budget B (USD), fixed-side planning
target C (USD), and simple annual APR R (percentage). The third is calculated:

```
R = (B / C) × (365 / D) × 100
C = B × 365 × 100 / (R × D)
B = C × R × D / (365 × 100)
```

For $10,000, $1,000,000, and three days, APR is 121.666666…%. A $100 request
commits $1 in premium at request-time prices. This is not compounded APY and
excludes fees, gas, and subsequent token-price changes. Duration starts when
the vault starts, not when a user requests it.

Use integer cents and the exact ratio, not rounded displayed APR. Round derived
premium/budget upward; round a derived planning target downward. Request premium
is `ceil(principalCents × budgetCents / capacityCents)`. Internal historical
`capacity*` fields express the rate/planning basis, not a maximum.

Freeze economics after the first quote. New economics require a new campaign.
A separate `advisoryBudgetCents` can change with a revision-protected admin write
without changing the premium rate or any existing quote.

## Private advisory, no hard capacity

Budget, raw premium, and fixed-side planning targets never reject requests.
There is no per-user count, per-browser count, global queue quota, public amount
review, or campaign-share restriction. Each separate request needs its own fee.
Valid positive amounts must still fit the token/contract integer representation.
An exact contract amount or insufficient user LP balance is not a capacity policy.

The admin portfolio compares request-time USD premium commitments with the
current advisory budget. At 90% it displays a near-capacity notice. At or above
100% it indicates the planning target is reached. Neither state blocks checkout
or execution. Public offers and modals contain no capacity meter or notice.
The public API discloses the premium rate and request terms, not planning totals.

Unpaid quotes commit no resources. Canonical paid requests add durable premium
commitments. External funding changes their observed funding classification;
it does not establish treasury inventory. Withdrawals do not replenish spent
premium accounting. Reorgs restore the relevant canonical accounting state.

## Quotes, payments, and recovery

Freeze the pool, verified decimals, price snapshot, LP liquidity, and exact raw
premium for each quote. Pay exactly its native ETH fee to its recipient with its
quote-bound calldata before the payment deadline. Verify canonical inclusion,
confirmation depth, payer, destination, amount, and data before admission.
One quote yields one intent; one canonical fee cannot authorize two requests.

Browser storage keeps multiple payment records and one navigation selection.
Web Locks serialize a wallet action to prevent duplicate sends; they do not
limit outstanding requests. A lost response remains recoverable without another
fee. The keyless watcher discovers payments independently of the browser.
The C05 tracker is removed; the payment review has an explicit Check payment
button. C06 follows the admitted request through creation and vault funding.

Late or duplicate fees remain visible to operators as payment exceptions.
An operator can admit an eligible original payment against its original terms.
Refunds, if necessary, are processed manually outside this application. There
are no refund request, refund verification, or retirement operations.

## Operational boundaries

Intake can be explicitly paused and has a declared expiry. The canonical watcher
must be healthy; automatic mode also needs the creator heartbeat. These safety
checks do not enforce budget, queue, wallet, treasury, or gas-spending quotas.

There is no treasury balance tracking or allocation. Observe the individual
vault's variable bearer supply and covered token balance before enabling LP entry.
An external funder must supply the frozen raw premium, regardless of market moves.
User LP recovery/claim/withdrawal still uses current on-chain ownership.

There are no gas reservation, rolling daily spending, or subsidy ledgers.
Per-transaction gas/price ceilings, the creator's ability to pay its transaction,
nonce protection, and permanent one-request permits remain signing safeguards.
Reviewed execution requires an exact passing fork simulation before signing.
