# Standalone application operations

Current policy: [CAMPAIGNS.md](../CAMPAIGNS.md). State/migrations:
[IMPLEMENTATION.md](../IMPLEMENTATION.md). Hosted disposable UI:
[VNC runbook](vnc/README.md). Historical acceptance files describe their original
versions; current external-refund verification is documented in [REFUNDS.md](REFUNDS.md).

## Fresh installation

1. Install the pinned package dependencies and PostgreSQL. Run the normal build.
2. Configure the ignored `.env` using `.env.example`: database, server-side RPC,
   current USD provider, exact origin, public fee recipient, and admin allowlist.
   Provision secrets with host secret management, never source or chat.
3. Review public factory/type identities against the target chain. Keep signer
   credentials out of the API; operator config contains protected references.
4. Start the API. Production catalogs are empty. Configure a verified pair and
   a campaign through the authenticated operator UI.
5. Supervise the keyless watcher, then explicitly enable an expiring intake window.
   Reviewed mode needs no continuously running signer. Automatic mode requires
   a separately authorized queue worker and its heartbeat.
6. Provision creator ETH and external premium funding independently. No treasury
   inventory allocation, balance check, or gas ledger is part of checkout.

Each exact canonical fee requests one vault. Users need no message login and
can keep any number of paid requests. Public hashes cannot restore private
recovery authentication. Operators use allowlisted message login and CSRF checks.

## Read-only services and prices

`RPC_ROBINHOOD` supplies the server's restricted chain reads. The price provider
at `PRICE_API_ROOT/<quote-token-address>/price?symbol=<symbol>` returns:

```json
{"success":true,"data":{"chainId":4663,"tokenAddress":"0x...","currency":"usd","price":2000,"timestamp":"2026-09-11T00:00:00.000Z"}}
```

Use an actual current timestamp and exact token address. Quotes require positive
prices no older than 60 seconds and no more than five seconds in the future.
Reward-token price derives from the verified pool and quote-token price; addresses
and decimals govern sizing. ETH/USD separately determines the immutable $2 fee.
The worker uses accepted frozen terms and does not call the price service.
`VITE_WALLET_RPC_ROBINHOOD`, if used for add-chain, must be an explicitly public URL.

The watcher uses `payments.example.json` and the supplied
`saffron-payment-watcher.service` supervision template. Start with an inspection:

```sh
npm run worker:payments -- "<protected-payments-config>" --once
```

Continuous mode polls every two seconds and scans at most 50 confirmed blocks per
tick by default. Retain its ID and start block across restarts. It takes an advisory
lock, checks canonical block continuity and retains candidate fees on RPC failure.
It must not skip ahead to make readiness look healthy.

## Planning and payment exceptions

Campaign targets are advisory, not hard limits. The operator portfolio alone
shows near-capacity at 90% of the editable internal premium planning budget.
Edit that budget through Campaigns without changing frozen rates or quotes.
Above-target commitments and any number of separately paid requests are allowed.
Generic HTTP abuse protection does not constitute a per-user vault quota.

C05 tracking is removed. Users recover from their saved payment review or
portfolio. The canonical watcher continues when their browser closes. C06 tracks
admitted creation and funding using shared database/API state.

Review duplicate/late/invalid payments in Administration. Original-payment
admission is revision-protected and audited against the original terms. Refunds
are paid externally and verified through [the refund workflow](REFUNDS.md).
Approval stops creation; canonical full repayment and execution reconciliation
permit terminal closure. Do not delete journal rows to remove exceptions.

## Signer and gas policy

Use a dedicated creator EOA that is not used by another transaction sender. The
API, observer, watcher, simulator and restore checker never load its key. Provision
protected credentials externally; do not put keys in arguments, environment,
source or config JSON. `saffron-vault-creator.service` is an automatic-mode template
with systemd encrypted credentials. Adapt deployment paths and account permissions
before installation. Native Windows DACL and Unix permission requirements are
specified in ONE-REQUEST.md; insecure existing paths fail without ACL repair.

Start from disabled `creator.example.json` or `one-request.example.json`. Inspect
factory/type hashes independently and verify exact terms with the fork simulator.
Example hashes record a prior inspection, not ongoing factory safety. Reviewed
execution requires a recent passing exact-request simulation and a permanent,
protected request permit. See ONE-REQUEST.md for its invocation and recovery rules.

For separately authorized automatic execution:

```sh
npm run worker -- "<protected-creator-config>"
```

`worker --once` performs a queue tick; it is not a one-vault authorization. Use
`worker:one` for a request-pinned invocation. Never start the queue worker merely
to make reviewed intake appear online.

`maxGasPerTx` and `maxGasPriceWei` bound each individual signature. The signer
checks its own ability to pay that transaction. These are transaction safeguards,
not aggregate spending tracking. No daily gas/subsidy accounting or reservation
is created. Canonical receipts remain in the journal for recovery evidence.

For reviewed one-request mode, `maxOneShotGasWei` is a fixed permit ceiling for
that invocation. Legacy `maxDailyGasWei` is accepted only as its alias. It does
not measure daily spending. Old `maxPremiumRaw`, `maxSubsidyWei`, and checkout
quota configuration no longer enforce admission limits.

## External funding and user rights

External funders review the accepted immutable request, fund its vault directly,
and retain variable bearer rights. The app does not poll their balances or track
inventory. Individual vault funding is still verified canonically before LP entry.
Partial funding remains pending. The creator never funds or collects premiums.
User recovery, claim, and withdrawal remain governed by actual token ownership.
See [external funding](TREASURY.md) for the boundary.

## Pause and process recovery

Pause intake before maintenance; this stops new quotes without discarding paid
work. Stop signer processes deliberately and preserve their permanent permits.
Keep watcher start blocks/cursors, database leases, and exact signed bytes.
Inspect uncertain receipts/nonces before resuming the same journal. Never erase
an unknown transaction to make a queue look empty. Canonical reorgs and missing
backup history require reconciliation; operator budget targets do not.

## Backup, restore and reconciliation

Protect database archives as signing-sensitive material. Maintain tested backups
and WAL/PITR continuity, plus matching protected configuration and permanent
one-request permits. Back up through PostgreSQL tools; copying live database files
is not a consistent backup. Record archive/WAL position and the deployed code/config
revision without exposing secrets. Test restoration in an isolated database.

A restore cannot establish that newer payments, signatures, broadcasts or treasury
operations never occurred. Before restoring, stop all signer processes and close
public intake at the edge. Restore the latest complete DB/WAL and protected permit
state. Keep the restored API inaccessible to public checkout. Immediately run:

```sh
npm run worker:restore-check -- freeze "<protected-creator-config>"
npm run worker:restore-check -- inspect "<protected-creator-config>"
```

These commands accept a disabled creator config and never load a signing key.
`freeze` pauses intake and all campaigns, marks reconciliation required and
invalidates cached liveness. It does not erase leases/journals or release funds.
`inspect` compares saved nonces, exact transactions/receipts, fees, watcher
cursors, vault observations and raw ledger totals with fresh canonical chain data.
The public report always has `activationAllowed:false`.

Even `recordedEvidenceMatches:true` compares only records present in the restored
database. Matching creator nonces do not prove that all later quotes or received
fees are present. The checker cannot reconstruct missing recovery commitments,
signed bytes or one-request permits. Audit backup/WAL completeness and the exact
signer history, reconcile later fee and vault activity, and resume canonical scans
from the preserved start block. Unknown or missing later state keeps signing and
intake stopped until complete recovery is available. Never override a nonce mismatch
by deleting rows or advancing the scanner start.

After evidence recovery, reconcile each campaign through the operator controls,
review protected permits and unresolved fees, then
explicitly reopen campaigns and a new bounded intake window. Reconciliation does
not unpause automatically. Deployment/receipt reorgs restore commitments; retain the pause until the ledger
and chain agree.

`npm run test:restore` exercises real pg_dump/pg_restore against two disposable
databases. A source vault created after the backup makes restored signer evidence
mismatch, and a restored worker sends nothing. This proves the tested duplicate
creation guard, not the completeness of an operator's live backup procedure.

## Validation and upgrades

Run the README unit/database/lifecycle/watcher/restore/browser checks and normal,
lab, demo, and preview builds where affected. Linux VNC tests use separate
headless browsers and synthetic state; use the VNC runbook to verify hosted
interaction without disturbing a populated test.

Before schema upgrades, take a consistent protected database backup and archive
non-Git service/browser state. Startup removes only the obsolete hard budget
constraint and adds the advisory column. Existing deprecated tables, accepted
quotes, historical events, and spent permits are preserved. Rollback requires
matching code/config and a deliberate data recovery plan, not a blind Git reset.

Never treat disposable or fork results as live-chain acceptance. No application
upgrade implicitly authorizes a live signing, funding, or refund transaction.
