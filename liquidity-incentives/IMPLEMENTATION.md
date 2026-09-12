# Standalone lifecycle implementation

See [CAMPAIGNS.md](CAMPAIGNS.md) for the current product policy and
[ops/README.md](ops/README.md) for operations. The UI, API, PostgreSQL schema,
watcher, creator, and vendored protocol/UI sources belong to this package.

## Authority and states

Chain 4663 and the configured unrestricted factory are authoritative. HTTP and
the payment watcher are keyless. The creator is a separate protected signer.
External funders own variable bearer rights; users own their actual LP/claim
rights. A request address or browser record never substitutes for token ownership.
Production catalogs start empty; only disposable fixtures seed sample data.

Browser payment records use prepared/submitting/submitted/confirming/accepted,
needs_attention, confirmed_unpaid, and abandoned. Legacy values remain readable.
`sent` preserves ambiguous outcomes. There can be multiple outstanding records.
The active pointer selects the displayed checkout, not a user quota.

Quote states `held`, `closing`, `accepted`, and `released` are retained for
canonical payment-window settlement; they no longer hold capacity or gas.
Payment proofs establish canonical fees. Payment exceptions retain duplicate,
late, or otherwise unresolved received fees. Approved accepted-request refunds
move through `refund_pending`, `refunded`, or `refund_exception`. Immutable batch
manifests bind exact original fee allocations; canonical payout identities prevent
double credit. See [refund operation and recovery](ops/REFUNDS.md).

Creator jobs are queued/running/waiting/failed/created/refunded. Only create operations
are executable. Saved retired/cancelled records are not silently reactivated.
The vault observer distinguishes awaiting funding, partial funding, funded,
and started/spent. Position actions depend on fresh canonical ownership.

## C06 and browser recovery

C05 elapsed tracking is removed. Check payment explicitly recovers an existing
fee; it never sends another fee for the same ambiguous payment. The independent
watcher continues discovery when the browser is closed.

C06 keeps four canonical milestones:

1. Adapter created with a matching AdapterCreated event.
2. Vault created with a matching VaultCreated event.
3. Vault initialized and its immutable terms verified.
4. Full premium funding enables entry, or a started vault proves prior funding.

Reorgs can revoke milestones. An occupied vault cannot take another LP deposit.
The shared poller preserves last-known state and disables unsafe actions when
verification is unavailable. No synthetic completion estimate replaces evidence.

## Storage

All application tables use schema `saffron_incentives`.

- `pairs`, `budget_pools`, `programs`: verified markets, frozen rate inputs, private
  advisory targets, and paid commitment accounting.
- `checkout_clients`, `deployment_quotes`: hashed browser capability, immutable
  quote terms, idempotency key, recovery commitment, and signer nonce checkpoint.
- `deployment_intents`, `budget_reservations`, `budget_entries`: one accepted plan
  per quote, premium commitments, and append-only canonical accounting evidence.
- `vault_jobs`, `chain_operations`: leases, exact signed bytes, unique nonces,
  and canonical receipt metadata. These are recovery records, not a gas ledger.
- `vault_observations`, `user_operations`: funding/ownership evidence and user
  transaction history, including canonical completion and ownership transfer.
- `intake_policies`, `intake_audit`, `worker_heartbeats`: explicit intake window,
  selected execution mode, and process liveness, without request-count quotas.
- `payment_scan_cursors`, `payment_proofs`, `payment_exceptions`,
  `payment_obligations`, `payment_resolution_audit`: canonical fee discovery,
  received amounts, exceptions, and audited original-payment admission.
- `refund_batches`, `refund_items`, `refund_submissions`: frozen manifests,
  original fee bindings, external hashes and durable verifier leases.
- `refund_payouts`, `refund_allocations`, `refund_verification_audit`: canonical
  payout identities, bounded credit and append-only verification history.

Private recovery capabilities stay in browser storage. Quotes keep only their
commitments. Public data excludes capabilities, cookies, raw signed bytes, and
internal planning totals. Database backups require protected storage.

## Upgrade contract

Back up PostgreSQL, local QA state, and permanent signer permits before upgrading.
Startup SQL adds the separate advisory budget column and removes the old SQL
constraint that capped reserved plus allocated premium at `limit_raw`.
It does not delete or rewrite accepted quotes, payment records, raw transactions,
old refund/gas/treasury tables, or historical retired records.

Fresh databases include external refund manifests, submissions, payouts and allocations.
They omit removed gas reservation, treasury inventory,
and amount-review tables. Legacy quota columns can remain for schema compatibility
but are not used for admission. Historical `capacity*` names remain rate inputs
or private accounting metrics, never hard limits. Old quote hashes stay intact.

## Invariants and validation

- Exact positive amounts and the immutable quote hash remain mandatory.
- Idempotency and canonical fee uniqueness prevent duplicate creation; no wallet,
  browser, campaign, or global pending count prevents another paid request.
- Pauses, watcher canonicality, and restore reconciliation remain safety gates.
- Signed bytes persist before broadcast. Unknown nonce outcomes never authorize
  another transaction. Reviewed one-request permits remain permanently spent.
- Funding follows canonical vault state, not treasury balance or admin flags.
- Restore starts paused and cannot prove missing history is complete. Saved quote
  signer nonces and transaction journals detect later creator activity.

Tests cover concurrent above-target commitments, 120 paid requests by one wallet,
private portfolio-only notices, multiple browser recovery records, lost responses,
real Uniswap lifecycle, exact fork simulation, reorgs, and restoration. The full
browser cycle records public fixture evidence in `validation/complete-cycle.json`.
Disposable and fork tests do not prove live mainnet acceptance.

VNC tools are maintained under [ops/vnc](ops/vnc/README.md), including regression
tests that never attach to the shared session. Linux/systemd hosts the viewer;
Windows supports the core app, build, local tooling, and remote viewer access.
Protocol sources retain SPDX notices; vendored UI/font licenses remain intact.
