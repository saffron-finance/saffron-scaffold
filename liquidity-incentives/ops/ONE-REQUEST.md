# Payment watcher and reviewed one-request creation

This is a separate, explicit execution mode. One vault requires **three** zero-value
transactions to the existing unrestricted factory on chain **4663**:

1. `createAdapter(2, reviewedPool, 0x)` — full-range adapter.
2. `createVault(1, observedAdapter)` — vault with the registered type.
3. `initializeVault(observedVaultId, rawLiquidity, rawPremium, durationSeconds, variableAsset, feeBps)`.

It does not deploy a new factory, fund premiums, deposit user LP assets, start the
vault, or run an unlimited queue. A created/initialized vault is not yet a funded,
depositable vault. External premium funding and user-wallet entry remain separate.

## Request and payment prerequisites

Use a real `saffron_incentives.deployment_intents` UUID created by this package's
native-ETH payment verifier. The request must be untouched, queued, on chain 4663,
with the authorized signer, an active reservation, and an immutable accepted plan.

The verifier binds the chain, payer, separate fee recipient, exact positive ETH
wei amount, quote/plan/recovery commitment, successful receipt and canonical
confirmations. Underpayment and overpayment cannot authorize creation, but a
recognized positive transfer to the receiver remains a received-fee obligation.
A self-transfer is not a received fee. The ETH amount is fixed by the backend quote; later ETH/USD movement
does not change the amount a paid request owes. Public payment evidence alone
cannot restore someone else's HTTP session.

The browser-only preview cannot create paid jobs. Production intake reserves
campaign, raw premium, treasury, queue and gas resources before offering a payable
quote. Source prices must be fresh at issuance; the separate mining window is
120 seconds. LP valuation and asset mix are refreshed later at fixed deposit.
Payment exceptions retain their original terms and deadline for audited resolution;
they never discard a received fee or automatically charge again.

## Local validation — no live key required

Use a disposable PostgreSQL cluster/test role, never a production connection.
The harness creates random test databases and generated local-only wallets.

```sh
npm ci
npm run build
npm test
npm run test:database
npm run test:lifecycle
npm run test:watcher
npm run test:restore
npm run test:browser
npm run demo -- --smoke
```

Set `SAFFRON_TEST_DB_HOST`, `SAFFRON_TEST_DB_PORT`, and `SAFFRON_TEST_DB_USER` to
that isolated cluster. Passwordless private Unix sockets avoid test credentials.
The watcher tests send real local ETH transfers, intentionally omit the browser
callback, scan canonical blocks, reserve one intent, fork-simulate it, and create
the actual fixture adapter/vault. Separate tests force response loss, a mined
revert, changed parameters, duplicate fees, reorgs, RPC outages and competing locks.

## Keyless payment watcher

Configure an operator-owned copy of `payments.example.json`. Pin `startBlock` at
or before the first supported fee. It cannot change after the cursor is created.
Start with a bounded inspection:

```sh
npm run worker:payments -- /protected/payments.json --once
```

Without `--once`, this process polls every two seconds. It is keyless and its RPC
transport rejects sending/signing/admin methods. It scans at most 50 confirmed
blocks per tick by default and indexes the public payment commitment.

Cursor progress is durable. Every block is rechecked before advancing; mismatched
parent/checkpoint hashes restart scanning at the original start. Concurrent
scanners take a PostgreSQL advisory lock. Missing/outage evidence cannot advance
past a candidate payment. Recognized wrong amounts and blocked/late received fees
remain actionable obligations. A second payment for one quote is stored in
`payment_exceptions`; it cannot create another vault or stall the entire scanner.
After a deep reorg, an accepted intent's worker independently revalidates its
payment before every new signature. Canonical replacement payments may require
operator reconciliation; the scanner does not erase old obligations.

## Prepare the exact real-chain simulation

1. Inspect one payment-backed UUID and export only its public job fields:
   `intent_id`, `wallet`, `signer`, `snapshot`, `plan`, and `plan_hash`. Do not export
   the database journal, signed raw bytes, session cookies or recovery secrets.
2. Copy `one-request.example.json` to a protected operator location. Set the public
   signer, reviewed limits, same database, that UUID and permanent state directory.
   Leave `enabled:false` while inspecting/simulating. Reinspect the factory hashes.
3. Configure `rpcUrl` for a private loopback endpoint **or** `rpcPassEntry` plus
   `rpcEntryName` for a protected dotenv bundle. Do not put a credentialed provider
   URL in a command, report, browser bundle or Anvil argument.
4. Simulate:

```sh
npm run worker:inspect -- /protected/one-request.json
npm run worker:simulate -- /protected/one-request.json /protected/job.json /protected/simulation.json
```

The simulator creates a private loopback bridge whose upstream is read-only, forks
the actual sizing block in Anvil, and impersonates the **public** creator address
locally. It never reads the live signing credential. All three factory calls and
the final vault invariants must pass. The output records the fork hash, exact plan
hash, calldata, local transaction hashes, gas and final observation. Those hashes
are **simulation-only**, not live chain transactions. The local fork clock advances
to current time for freshness checks; original protocol parameters remain fixed.

Anvil account reads are concurrency-limited to avoid provider throttling. Read-only
transport retries are bounded; broadcasts never get hidden transport retries.
Anvil output is suppressed so its generated fixture accounts cannot leak to logs.

## Protected signer and one invocation

The live worker supports an owner-only `signerCredentialFile` or an encrypted
`signerPassEntry`, never both. `signerKind` is `privateKey` or `mnemonic`; mnemonic
mode uses the first standard Ethereum account. The derived public address must
match the authorized address. No signer is loaded by the API, payment scanner or
fork simulator. This does not replace OS separation: keep API and worker users,
database permissions, backup access, and signer files isolated.

On Unix, credentials and state require private permission bits (`0600` files,
`0700` directories); operator configuration must not be writable by group or
others. On Windows, the worker checks the native DACL and owner instead of Unix
mode bits. Private files/directories may grant access only to the worker account,
SYSTEM and built-in Administrators. Configuration may grant other accounts read
access, but no write, delete, ACL or ownership rights. Inherited grants are checked
too. Symbolic links, junctions and other reparse points are rejected.

Provision credential files with these permissions before using them. A missing
state directory is created with a private, inheritable DACL on Windows; an existing
unsafe directory is rejected without changing its ACL. Windows requires the
built-in Windows PowerShell security services; unavailable ACL evidence fails
closed. The disposable permission tests exercise these same checks without a
live credential or a platform-specific security bypass.

After concrete review and authorization, set `enabled:true` in the protected copy.
Run the dedicated one-request command, **not** ordinary `worker --once`:

```sh
npm run worker:one -- /protected/one-request.json
```

Before the first signature it requires a recent (10-minute) passing simulation,
the same canonical fork block and plan, a clean matching latest/pending nonce,
and enough native ETH to cover the complete conservative gas budget.

The owner-only state directory has an exclusive lock and an fsynced permanent
permit. The permit binds one UUID, signer, plan and simulation hash. The signing
gate permits at most three journaled, sequential, zero-value factory calls, exact
calldata, continuous nonces, and the total gas budget. The ordinary queue command
explicitly rejects this config. It cannot select another queued request.

State contents are synced before replacement. Unix then syncs the parent directory;
Windows uses same-volume `MoveFileExW` replacement with `MOVEFILE_WRITE_THROUGH`,
because Node cannot sync a Windows directory handle. Files inherit the private
directory ACL, and replacement failures stop execution before further signing.

The worker revalidates the payment, immutable request copies, current factory/type
hashes, fee setting, fresh head, reservation/pauses and gas limits before each new
signature. It persists signed bytes before sending. Final verification checks
factory registrations and creator, vault/adapter bytecode, pool/tokens/range,
liquidity, premium, duration, protocol fee and initialized/unfunded state.

## Stop and recovery rules

- **Completed:** the permit is permanently spent; rerun returns the saved result
  and sends nothing. A different request/simulation is rejected.
- **Unknown/lost send response:** retain the exact journaled bytes. Restart with
  the same permit to reconcile the same hash; never sign a replacement blindly.
- **Proven revert:** the one attempt is terminal. No automatic new nonce, resume,
  different request or second vault. Partial adapter/vault state may exist.
- **Timeout:** preserve the armed permit and journal. It is not proof of failure.
- **Hard crash:** an on-disk lock may remain. Inspect the process, pending/latest
  nonce, every saved hash and receipts before deliberately clearing only that
  stale lock. Never remove `state.json` or journal rows to bypass the one-vault limit.
- **Competing sender or external nonce:** stop and reconcile. A directory/advisory
  lock cannot stop someone using the same private key elsewhere.
- **Database restoration:** follow the [freeze and reconciliation procedure](README.md#backup-restore-and-reconciliation).
  An older backup cannot establish that later payments or signatures never existed.
- **No indefinite activation for a one-off test:** do not install/start the ordinary
  signing service merely to validate a single request. Only the chosen one-request
  invocation is authorized; extra funding or user LP transactions are outside it.

## Evidence to retain

Save the request/payment identifiers and immutable terms, reviewed code commit,
factory/type hashes, fork input/result, test summaries, public nonce/balance
before/after, the three live transaction hashes and canonical receipts, actual gas
fees, and final vault/adapter/state. Keep the raw signed journal protected and out
of shared report bundles. Clearly distinguish tests, fork simulation and live
deployment; an initialized but unfunded vault is not a completed user LP deposit.

## Completed live test and mandatory pre-deployment forks

The [11 September vault #2 log](live-tests/2026-09-11-vault-2/README.md) records a
successful, separately operator-authorized deployment: three canonical factory
transactions, exact premium/duration, and independently verified initialized but
unfunded state. The exact funded-EOA deployment was fork-simulated **before** any
live signature. A separate ephemeral-account fork tested execution and recovery.
This did not exercise real native-payment detection and did not fund/deposit LP.

For every new live deployment, simulate the exact immutable terms against the
actual factory/type bytecode and canonical sizing block first. The ordinary
one-request runner requires a passing simulation less than ten minutes old
before its first signature. A different request or changed terms need a new
simulation; recovering already-signed bytes does not authorize a new deployment.

A real requester wallet is needed for application identity and later user actions,
**not** for factory creation or initialization. The state reader uses a zero-address
observer when no viewer exists; this neither reserves the vault nor assigns LP
ownership. A preview ID is not a verified payment or a real requester identity.

New EIP-155 transactions include one current base fee of gas-price headroom. The
simulator uses the same policy. Configured per-transaction and aggregate budgets
remain hard limits. Already-journaled bytes/hash/nonce never change during recovery.

Additional read-only actual-factory recovery reproduction is opt-in:

```sh
npm run test:operator-fork -- /protected/read-only-fork.json
```

The config supplies the reviewed chain/type hashes, public limits and protected
RPC reference from the existing operator examples. The test generates an
ephemeral local account, never loads the live signer, rejects upstream signing
and broadcast methods, and writes its new evidence into a private temporary
directory. It does not overwrite the historical live-test evidence.

## Intake and bounded execution

Intake starts closed. In Administration, choose reviewed one-request or automatic
queue execution, a window of at most 24 hours, a declared service window and a
pending-work ceiling. Pausing or expiry stops new quotes and preserves paid work.
A keyless watcher must report a canonical checkpoint within 32 confirmed blocks,
checked within 15 seconds, with a current chain head. Queued work older than the
service window closes intake. Automatic mode additionally needs the ordinary
signing worker's heartbeat; reviewed mode does not. Running a one-request or
retirement command does not advertise a continuously available signing worker.

Supervise payment ingestion independently using `saffron-payment-watcher.service`.
Pin its chain, watcher ID and start block. Restart after an outage using the same
cursor identity; never advance its start to skip unprocessed payments.

For a failed one-request permit, inspect/reconcile saved transaction hashes and
approve retirement of that exact request in Administration. Use `worker:retire`
with an operator configuration whose mode is `retire-request`, plus the exact
`requestId` and `planHash`. Retain the original public protocol/database/RPC fields;
no signer credential or simulation is read by this command. It can rebroadcast
only saved bytes for the pinned request and cannot sign a new vault. Finish any
external variable/fixed recovery first. Once retirement is proven, resolve the
original fee through the payment queue. An exhausted creation permit remains
terminal; the broad queue runner rejects both kinds of one-request configuration.

```sh
npm run worker:retire -- "<protected-retirement-config>"
```

Retirement does not send a fee refund. Record an externally executed refund in
the payment queue after canonical retirement and recovery evidence is established.
