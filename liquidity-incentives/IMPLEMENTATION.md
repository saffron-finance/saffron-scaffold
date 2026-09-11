# Standalone lifecycle implementation

This is the state and storage contract for the liquidity incentives application.
[CAMPAIGNS.md](CAMPAIGNS.md) defines economics and payment policy;
[README.md](README.md) covers setup; [ops/README.md](ops/README.md) covers operation.

## Boundaries

The application owns its UI, API, PostgreSQL database, observers, payment watcher
and creator. Chain 4663 and the configured unrestricted factory are authoritative.
The browser uses an explicit native ETH payment and ordinary fixed-side wallet
transactions. Only allowlisted operators use message authentication. HTTP handlers
and the payment watcher are keyless. A protected separate signer pays creation gas;
a separate treasury deposits premiums and owns the variable-side rights.

The production catalog starts empty. Fixtures and preview data cannot seed or
admit production requests. Vendored protocol/UI sources are maintained within
this package; source attribution does not imply a dependency on another app.

## State contract

These states describe different facts. Clients must use action eligibility and
canonical evidence, rather than promote one layer's status into another's success.

| Layer | States / values | Meaning |
| --- | --- | --- |
| Browser payment record | `prepared`, `submitting`, `submitted`, `confirming`, `accepted`, `needs_attention`, `confirmed_unpaid`, `abandoned`, `refunded` | Durable per-wallet transaction recovery. `sent` preserves ambiguity; clearing a modal never establishes nonpayment. |
| Unpaid amount review | `pending`, `approved`, `declined`, `expired`, `used` | Exact-size public-limit exemption; no reservation or fee until an ordinary quote succeeds. |
| Quote hold | `held`, `closing`, `accepted`, `released` | Payment review reserves resources. Closing awaits canonical watcher settlement; accepted converts once to a paid commitment. |
| Payment proof | `verified`, `fulfilled`, `needs_attention`, `refunded` | `fulfilled` means one request was admitted, not that its vault was delivered or funded. |
| Received-fee obligation | `received`, `admitted`, `needs_attention`, `refund_due`, `confirming`, `refunded`, `reconciliation_required` | Current auditable service/refund outcome. Admission may have a narrowly bound operator override. |
| Refund transfer | `confirming`, `confirmed`, `orphaned`, `failed` | Evidence for an externally executed direct ETH transfer. Partial amounts remain owed. |
| Creator job | `queued`, `running`, `waiting`, `failed`, `created`, `retired` | Protected execution/recovery state. `created` means initialized, with external funding still possible. |
| Job operation | `create`, `observe`, `retire` | No premium-funding or user-deposit operation exists in the creator. |
| Request status | `queued`, `created`, `active`, `needs_attention`, `retired` | Durable request/commitment lifecycle. A started request remains spent after the wallet withdraws. |
| Observed funding | `unverified`, `awaiting_external`, `partial`, `funded`, `spent` | Derived from fresh canonical vault state, not an operator-editable funding flag. |
| User position | `queued`, `deploying`, `creating`, `checking`, `needs_attention`, `awaiting_funding`, `depositable`, `fixed_awaiting_funding`, `occupied`, `claimable`, `active`, `matured`, `no_position`, `retirement_requested`, `retired`, `completed` | Wallet-specific display/action state. Current token ownership controls claim/recover/withdraw. `completed` requires canonical withdrawal evidence and no remaining position. |
| Intake mode | `reviewed`, `automatic` | Reviewed mode requires bounded operator execution and a keyless watcher; automatic mode additionally requires the queue worker heartbeat. |

`deploymentProgress()` returns version 1 with four ordered milestones:

1. Prepare adapter: matching canonical `AdapterCreated` event.
2. Create vault: matching canonical `VaultCreated` event for that adapter.
3. Initialize and verify: matching `VaultInitialized` event and fresh vault reads.
4. Fund premium and enable entry: full variable bearer supply and covered token
   balance, or a canonically started vault whose premium is already spent.

Milestone states are `pending`, `active`, `complete`, `checking`, and `blocked`.
One transaction cannot complete two milestones. Reorgs can revoke a completed
stage. Progress includes the accepted time, confirmed event times, last checked
block, verification availability, operator-action reason and service window.
A fully funded but occupied vault still cannot accept another fixed deposit.

The shared five-second poller prevents overlap, aborts obsolete requests, refreshes
on foregrounding and backs off to 30 seconds on failure or while hidden. The
one-second elapsed display is local. Last-known data survives outages, while
chain-dependent actions stay disabled. There is no synthetic completion ETA.

## Storage map

All tables live in `saffron_incentives`; [server/incentives.sql](server/incentives.sql)
is an empty-database bootstrap. It contains no startup backfills or user signatures.

| Tables | Responsibility |
| --- | --- |
| `pairs`, `budget_pools`, `programs` | Verified market definitions, USD campaigns and cumulative raw accounting. |
| `checkout_clients`, `checkout_reviews`, `checkout_review_audit` | Hashed browser admission capability, bounded unpaid amount reviews and decisions. |
| `deployment_quotes`, `gas_reservations` | Immutable payable terms, raw/USD/queue holds, canonical settlement checkpoint and signer gas exposure. |
| `deployment_intents`, `budget_reservations`, `budget_entries` | Exactly one accepted plan per quote, reserved/allocated/released premium and append-only accounting evidence. |
| `treasury_allocations`, `treasury_allocation_audit` | Explicit lifetime token limits against named treasury holdings, with audited revisions. |
| `vault_jobs`, `chain_operations` | Leases, request-pinned execution, nonce uniqueness, protected signed bytes and canonical receipt metadata. |
| `vault_observations`, `user_operations` | Funding and ownership observation, transfer-discovery cursor, verified user actions and completion history. |
| `intake_policies`, `intake_audit`, `worker_heartbeats` | Expiring intake authorization, declared service limits and automatic signer liveness. |
| `payment_scan_cursors` | Independently supervised keyless discovery and canonical hold-settlement watermark. |
| `payment_proofs`, `payment_exceptions`, `payment_obligations` | Original and extra received fees, actual amounts, evidence and actionable outcomes. |
| `payment_resolution_audit`, `refund_transfers`, `refund_evidence` | Serialized admission/refund decisions and uniquely allocated external refund evidence. |

Private recovery capabilities stay in the browser; only their commitments are
stored in quotes. Public metadata excludes cookies, secrets and raw signed bytes.
Database backups contain the protected transaction journal and need restricted
access even though some request/transaction metadata is public.

## Atomic and canonical invariants

- Global admission lock precedes the campaign lock. A firm quote reserves USD
  premium, fixed capacity, raw premium, wallet/global pending slots, treasury
  allocation and creation gas together. Conversion cannot compete for them again.
- One browser request key yields one quote. One quote yields one intent/job, and
  one canonical fee cannot authorize two requests. Operator writes bind a revision,
  unique request key and reason; audit records preserve the resulting decision.
- No timer releases a paid commitment or ambiguous signed transaction. Unpaid
  release needs a confirmed canonical watcher checkpoint beyond the mining deadline.
- Funding allocation follows bearer supply and canonical block evidence. Claims,
  maturity and withdrawal do not replenish spent campaign premium or capacity.
- Refund decisions serialize against creation authorization. Original-fee refunds
  require the saved creator work and unused vault to be retired; duplicate-fee
  refunds leave the original request's premium commitment intact.
- Signatures require immutable terms, canonical payment, current factory/types,
  safe nonce, campaign/gas policy and the protected execution permit. Signed bytes
  persist before broadcast. Unknown outcomes never justify a fresh nonce.
- Fresh wallet balances authorize claim/recovery/withdrawal. Request identity grants
  management rights only; it cannot grant ownership of another wallet's bearer.
- Restore always starts paused. Matching recorded evidence is necessary but does
  not prove backup completeness or authorize signing. See the restore runbook.

## Implementation and validation map

| Surface | Production code | Required evidence |
| --- | --- | --- |
| Checkout/recovery | `payment-records.mjs`, `useDeploymentFlow.ts`, admission and quote services | Stale tabs, lost wallet/API responses, storage failure, exact payment and capacity races. |
| Fee resolution | Payment watcher, payment/refund resolution services | Lost callback discovery, duplicate/late fees, audited original admission, partial refund and reorg reconciliation. |
| Intake and economics | Intake policy, gas reservations, treasury inventory, campaign accounting | First reviewed request without signer heartbeat; gas/subsidy/queue/inventory limits before payment. |
| Creation | Creator journal, one-request permit, fork simulation and retirement runner | Exactly three calls, interruption at every stage, unknown nonce/revert/reorg, no extra request selection. |
| Waiting and entry | Deployment progress, shared poller, waiting screen and lifecycle panel | Real milestones, funding delay, outage/reload, fixed-only entry, accessibility and reduced motion. |
| Position lifecycle | Vault reader, position actions/discovery, budget observer | Actual Uniswap mint, delayed claim, ownership transfer, early recovery, maturity and withdrawal. |
| Operations | Protected files, operational status, restore verification | Native ACL checks, safe metrics and actual backup/restore detecting later signer activity. |

The joined production browser scenario creates an empty catalog through the
operator API, pays test ETH with the callback deliberately lost, recovers through
the watcher, fork-simulates and executes one pinned request, partially then fully
funds from a distinct treasury, and completes fixed deposit, claim and withdrawal.
It records public hashes and final accounting in `validation/complete-cycle.json`.

Use the verification commands in README for unit, database/API, watcher, lifecycle,
restore, browser, demo, normal/lab and isolated preview checks. The accepted
publication artifact must contain only public evidence, never the protected dump,
signer permits or raw journal. Live full-cycle acceptance requires its own actual
payment, funding, deposit, claim and final withdrawal; disposable results and the
creation-only live record do not establish that milestone.

Protocol test sources retain their source/SPDX notices under `tests/protocol`.
UI attribution remains in [vendor/fixed-income-ui/README.md](vendor/fixed-income-ui/README.md);
bundled fonts retain their Open Font Licenses.
