# Campaign budgets, external funding, and ETH-paid creation

Current product specification, 2026-09-10. This supersedes the fee-free signed
request and worker-controlled premium funding design at `213794c`.

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

No separate treasury approval/execution pipeline is added to this application.
A configured accounting budget is a commitment limit, not custody or proof of cash.

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

For new USD campaigns, the raw-token ledger remains exact chain-unit telemetry;
the campaign USD budget and fixed-side target are the authoritative aggregate
limits. The worker's per-vault raw premium/gas ceilings remain independent bounds.
Historical token-only budgets remain readable and retain their raw-token limit.

The catalog exposes these separate quantities:

- **Payment holds:** quoted, not yet accepted requests. Hold capacity while the
  user submits and confirms the fee; expire after the payment deadline plus a
  15-minute receipt/recovery grace. A private-capability cancellation releases an
  unpaid hold. A verified blocked payment is retained for operator attention.
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

Save the request before opening the wallet and save the payment hash before API
submission. One quote/payment can create only one intent/job; retries return the
same result even after the quote expires. Lost wallet responses accept the existing
payment hash from the user's wallet history. Never request a second payment to
repair a lost response. A reverted/cancelled payment pays no creation fee (gas may
still be spent). A late valid fee or other confirmed-but-blocked request stays in
`payment_proofs` for external operator resolution; there is no automatic refund or
unrelated replacement-vault creation.

## Upgrade and integration boundary

The standalone schema adds campaign JSON and payment proofs, and permits null
historical signature columns. It preserves existing raw ledgers and transaction
journals. Drain/reconcile pre-upgrade signed-only creation/funding jobs before
activating the new worker: old authorizations are not silently converted to paid
requests, and this worker does not execute old funding/collection operations.

This is not yet a fixed-income migration or deployment. That integration still
needs versioned shared migrations, API/auth adaptation and links to canonical
indexer vault/position records. External treasury custody remains outside this
package in either hosting arrangement.
