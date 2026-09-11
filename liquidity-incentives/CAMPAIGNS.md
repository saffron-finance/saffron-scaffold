# Campaign budgets, external funding, and ETH-paid creation

Current product specification for the standalone application. Implementation state
names and storage boundaries are defined in [IMPLEMENTATION.md](IMPLEMENTATION.md).

## Responsibilities

- **Campaign application:** define terms, calculate the missing economic input,
  gate admission, reserve and account for capacity, create matching vaults, verify
  external funding, expose fixed-side deposit/claim/withdrawal.
- **External operations/treasury:** custody funds, validate requested vaults against
  campaign terms, deposit premiums into their variable side, own variable bearer
  rights, and recover unused premium or collect variable earnings externally.
- **Creation worker:** isolated EOA funds creation gas only; durable transaction
  journal and canonical recovery remain. It cannot fund or collect premiums.
- **User:** one explicit $2 native ETH creation payment, then separate wallet
  approvals and LP transactions. No sign-in message or EIP-712 deployment signature.
  Operator administration has a separate allowlisted message-login boundary.

Treasury checks each created vault and funds it externally. Complete canonical
funding is the release signal; there is no additional publication approval flag.
A configured accounting budget is a commitment limit. Explicit treasury inventory
allocations and canonical balance checks are also required before issuing quotes.

## Campaign creation and calculator

At `/admin`, configure a chain-verified pair, then **Create campaign**. Enter a
whole duration in days and exactly two of **Budget (USD)**, **Target fixed-side
capacity (USD)** and **Target APR (%)**. Select the field to calculate; it is
read-only. New campaigns can start paused and be resumed later.

Let `B` be budget USD, `C` target fixed-side USD, `D` duration days, `R` APR as a
percentage (121.67 means 121.67%, not 1.2167%). Use a simple 365-day year:

```
R = (B / C) × (365 / D) × 100
C = B × 365 × 100 / (R × D)
B = C × R × D / (365 × 100)
```

Duration means each vault's lock **after it starts**; it is not an enrollment
start/end date. APR is not compounded APY, and excludes the creation fee and gas.

Example: `B=$10,000`, `C=$1,000,000`, `D=3` gives **121.666666…% APR** (1% premium
over three days). A $500,000 fixed-side request requires $5,000 of premium.

USD values use integer cents. When deriving a budget, round funding up to a cent;
when deriving capacity, round supportable capacity down to a cent. Store the exact
budget/capacity ratio and use it for requests, not a rounded display APR. Each
request books `ceil(principalCents × budgetCents / capacityCents)` premium cents.
Many small requests can leave a small amount of capacity unusable because each
premium is conservatively rounded up. Admission checks **both** remaining budget
and remaining capacity.

Campaign economics become immutable after the first quote; pause/resume and names
remain editable. Create a new campaign to change economics. Programs referencing
a campaign consume the same budget under its database row lock.

## USD versus contract amounts

The configured pair's reward asset is the variable-side ERC-20, not necessarily a
stablecoin. Each quote freezes pool state, verified decimals, quote-asset USD price,
fixed liquidity and exact premium raw units. Its campaign premium **USD book value**
is saved alongside that raw amount. Raw premium is rounded upward to avoid an
underfunded obligation. Later token-price moves do not revalue or replenish this
campaign ledger; operations must deposit the frozen **raw token amount**.

Thus "$5,000 funded" means the request-time USD valuation of the matching premium,
not a claim that volatile tokens are worth exactly $5,000 at funding or maturity.
The fixed-side capacity likewise uses request-time USD value. The entry-time LP
mix may move with pool prices; neither APR nor target USD implies a guaranteed
mark-to-market return.

## Accounting and admission

Public checkout defaults to at most 10% of a campaign per quote and 25% held by
all unpaid quotes together, with at most 32 open checkouts globally. The catalog
reflects the public per-vault limit. `SAFFRON_CHECKOUT_POLICY` can tune these bounds.
Browser admission uses an HttpOnly capability with one unpaid quote per browser,
bounded issuance and durable idempotency keys. It is not proof of wallet ownership;
the native payment still establishes the payer. Trusted direct-peer limits ignore
forwarded client headers. Public deployment must also configure per-client edge
rate limits/challenges; rotating wallets is not an effective quota identity.

Larger requests use **Request amount review**, without payment or a resource hold.
An operator can approve one exact wallet/program/amount for 15 minutes. The user
then obtains an ordinary firm quote. The approval exempts that request from public
size/share limits only; campaign, raw-token, treasury, queue and gas checks still
apply atomically. Pending reviews expire after 24 hours. See [TREASURY.md](ops/TREASURY.md).

USD campaign budget and fixed-side target limits apply alongside exact raw-token
limits and the named treasury allocation. The worker's per-vault raw premium/gas
ceilings remain independent bounds. An allocation cannot promise more unspent
tokens across campaigns than the assigned wallet canonically holds once.

The catalog exposes these separate quantities:

- **Payment holds:** reserve USD budget, fixed capacity, raw premium and both
  wallet/global queue slots before payment. Fresh source prices (at most 60 seconds
  old) are frozen into a 120-second mining window. Expiry or a private-capability
  withdrawal closes a checkout; only a canonical watcher checkpoint beyond its
  deadline can release an unpaid hold. A timely payment discovered later retains
  its admission. A reorg restores released holds and requires reconciliation.
- **Reserved:** accepted, not yet premium-funded capacity and budget. Quotes are
  replaced by reservations atomically, not counted twice.
- **Funded:** the fraction of each committed premium represented by confirmed
  variable bearer supply; the matching fraction of fixed-side capacity is funded.
- **Available:** target minus payment holds, reservations and funded commitments.
- **LP deposits observed:** actual confirmed fixed-side entry, reported separately.
  Paying the premium does not prove that an LP has entered the vault.

For the example, after one $500,000 request is fully funded with its $5,000 premium
and there are no other holds/reservations:

```
Budget:          $10,000 total = $5,000 funded + $5,000 available
Fixed capacity:  $1,000,000 total = $500,000 funded + $500,000 available
LP deposited:    $0 until the fixed-side deposit is actually observed
```

Reservations **already reduce availability before funding**. Otherwise concurrent
users could pay for/create vaults exceeding the campaign. A fully committed campaign
admits no new requests even if the treasury has not funded all its vaults yet.

Accepted paid reservations never disappear solely because the worker is offline,
its old reservation timestamp passes, a receipt response is lost, or the user
claims/matures/withdraws a started position. Funding moves reserved to funded;
claim/maturity preserve spending. Pre-start withdrawal by the external funder
restores the reservation, not availability. Only reconciled cancellation/unused
vault retirement releases a commitment. A reorged release freezes admission and
restores the obligation; no further requests are admitted while accounting needs
reconciliation.

## External operations handoff

The operator view exposes deployment ID, campaign/program snapshot, requester,
chain/factory, vault and adapter, duration, exact fixed liquidity, reward asset,
premium raw amount, recorded USD values, transaction journal and canonical funding.
Operations should validate these against its own rules before moving money.

1. Wait for confirmed adapter → vault → initialization.
2. Independently check the matching vault terms and outstanding premium.
3. Approve the vault to spend the required reward token from the treasury wallet.
4. Call `vault.deposit(outstandingPremiumRaw, 1, "0x")` from that wallet.
5. The application observes canonical variable bearer supply and moves the matching
   reserved budget/capacity to funded. It enables LP entry only after full supply
   **and** adequate token balance are confirmed.

A plain ERC-20 transfer does not mint variable bearers and does not count as
funding. The external depositing wallet owns the variable-side rights; the creator
worker does not. Recovery and variable earnings collection remain external.

## ETH creation payment

Configure public `SAFFRON_CREATION_FEE_RECIPIENT`. Missing receiver or fresh ETH/USD
pricing disables new fee quotes. The fee is **$2 in native ETH on chain 4663 only**,
plus the user's network gas. There is no USDC selector, ERC-20 fee approval or permit.
The quoted wei amount is `ceil(2 × 10^36 / ETH_USD_price_1e18)` and remains exact for
that quote; it is not recalculated when the user submits the receipt.

The wallet sends the fee to that receiver with a calldata hash committing to quote
ID, full plan hash and a private browser recovery capability's hash. This is an
ordinary native ETH transaction with data, not an additional message signature or
payment contract. The receiver must accept native ETH with that calldata (an EOA
works). The API checks actual transaction sender, receiver, exact value/calldata,
chain, successful canonical receipt, minimum confirmations and mining deadline.
The worker rechecks the canonical fee before each new creation transaction.

The payment is consent to the exact requested vault and proves the paying wallet's
identity. A public transaction hash alone must not grant a browser session: anyone
can copy it from an explorer. The browser's private recovery record is bound by the
payment and restores the payer's HttpOnly/CSRF session without message signing.
Do not share or log that recovery record. Public position reads and onchain LP
ownership do not require an application login.

The browser persists a per-wallet recovery ledger before opening the wallet and
records ambiguous submission before awaiting its response. Payment and LP wallet
actions share a cross-tab lock. Revision checks prevent stale tabs or callbacks
from clearing a submitted fee. Accepted request/session data is retained before
the active pointer is retired. Storage failure stops before a wallet payment.

One quote/payment creates at most one intent/job; retries return the same result.
The keyless watcher admits a canonical payment without the browser callback.
Private recovery restores the session after reload; a wallet-history hash can
reconcile a lost send response. Nothing automatically sends a second fee. A
verified revert or same-nonce zero-value self-cancellation establishes no received
fee, although network gas may have been spent. Unknown outcomes remain recoverable.

## Standalone deployment and custody boundary

This package owns its UI, API, PostgreSQL schema, canonical observers, payment
watcher and creation worker. Its catalog starts empty. It operates the common
on-chain product independently, with no other application required for the user
cycle. Packaged source provenance does not create a runtime integration dependency.

The server and payment watcher are keyless. Protected creator custody pays factory
gas; the separate treasury owns premiums and variable rights; the user's wallet
owns fixed-side actions. A request association does not confer exclusive on-chain
entry rights. Another fixed depositor can occupy an unrestricted vault, and fresh
ownership checks must govern the actions shown to each wallet.

## Creation payment resolution

Every recognized successful ETH transfer to the quoted recipient has an obligation
record with its actual received amount. The operator payment queue includes late,
duplicate, underpaid, overpaid, policy-blocked and failed-creation cases. Public
wallet status and private checkout recovery preserve visibility without turning a
public transaction hash into session authentication.

Operator actions require the current row revision, a unique request key and a
reason. Admission retains the original quote and deadline, reserves any released
resources again and records a payment/plan-bound authorization checked by the
worker. A refund-due decision freezes new creation; saved transactions must still
be reconciled and any original partially created vault safely retired. Resolving
a duplicate fee never releases the original request's premium commitment.

Refunds are executed externally from an EOA in `SAFFRON_REFUND_SENDERS` to the
original payer. Record the hash in the payment-resolution panel. The verifier
requires the correct chain, direct positive native transfer, sender, recipient,
successful canonical inclusion and confirmation depth. Contract-treasury internal
transfers are not supported evidence. Partial refunds remain owed; submitted
transfers reserve their amount until their outcome is reconciled. A transaction
cannot be allocated to two obligations.

On a reorg, admission pauses and the fee returns to reconciliation. Verify the
saved refund or its same-nonce replacement. A successful zero-value self
cancellation proves that nonce did not deliver the refund and permits a fresh
external transfer. This never initiates a new payment or refund automatically.
The operator audit endpoint retains reasons, actors and public evidence. Original
request retirement and external position recovery must be verified before its
refund is recorded; duplicate-fee refunds leave the original commitment intact.

## Creation gas and subsidy

The creation price remains $2 in native ETH. Public protocol configuration must
include `maxGasPerTx`, `maxGasPriceWei`, `maxDailyGasWei` and `maxSubsidyWei`.
Checkout reserves three times the per-transaction gas and price ceilings: the
hard upper bound for the supported three-call factory flow, not an average-cost
forecast. Tighten ceilings only using verified factory/type simulations. Exact
one-request fork simulation remains mandatory before the protected signer runs.

Gas holds share the global admission transaction with premium and queue holds.
Before a quote, canonical signer balance, fee price, gas headroom and receipt
history must be available. The fee recipient is separate; fee income does not
increase the signer's ETH balance. Creation signatures cannot exceed the original
job gas reservation. A later gas spike pauses the same paid request; it never
changes the committed user fee or requests an automatic top-up.

Daily gas uses a rolling 24-hour window based on canonical receipt time. Pending
signed commitments and remaining creation ceilings survive the window boundary.
At canonical completion or retirement, unused gas exposure is released and actual
receipt gas remains spent. Orphaned receipts return to outstanding exposure.
Subsidy is the positive difference between the job's actual plus outstanding gas
and its retained creation fee. The full job subsidy remains booked while work is
pending and for 24 hours after its last gas receipt. Refund-due fees provide no
projected subsidy credit. Administration displays fee receipts, actual gas,
outstanding exposure, signer balance and remaining subsidy allowance separately.
