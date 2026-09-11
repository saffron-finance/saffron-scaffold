# Standalone application operations

[CAMPAIGNS.md](../CAMPAIGNS.md) defines payment/economic policy and
[IMPLEMENTATION.md](../IMPLEMENTATION.md) defines state names and storage.
Use [ONE-REQUEST.md](ONE-REQUEST.md) for reviewed creation and
[TREASURY.md](TREASURY.md) for inventory, external funding and recovery.

## Process and custody boundaries

| Component | Required mode | Responsibility |
| --- | --- | --- |
| Built UI, Node API and observer | Both | Serve the standalone flow, admit verified payments, observe funding/positions and expose operator controls. Keyless; the public RPC relay only permits reads. |
| PostgreSQL | Both | Quotes, paid obligations, accounting, audit, canonical cursors and protected signed transaction journal. |
| Keyless payment watcher | Both | Continuously scan confirmed fees and settle unpaid holds even when the browser is closed. Supervise separately from the signer. |
| Request-pinned creator | Reviewed | Inspect/simulate one exact request and run its protected permanent permit. No continuously running signer is needed for intake. |
| Queue creator | Automatic | Continuously execute admitted jobs under signer locks and gas limits; heartbeat is additionally required for new intake. |
| External treasury | Both | Hold allocated tokens, review/fund vaults, recover unused variable deposits, collect variable earnings and execute fee refunds. |
| User wallet | Both | Send the quoted native ETH fee, then explicitly wrap/approve/deposit the fixed side, claim, recover or withdraw. |

The chain is **4663**, and the unrestricted factory is
**0xCe97eE64AD415976c465A783725014e67832BE1A**. Creation has three factory calls;
external premium funding is a separate release step. No HTTP endpoint starts a
signer, moves treasury assets or creates an individual vault administratively.

## Fresh installation

1. Install Node 22.9+, run `npm ci` and `npm run build` in this package. Retain npm
   optional dependencies for the pinned platform-specific Anvil test binary.
2. Provision a dedicated empty PostgreSQL 16+ database. The schema initializes
   under a database lock and the production catalog stays empty. Production roles
   do not need CREATEDB; disposable test roles do. Restrict application/worker DB
   access and backups because the journal contains broadcastable signed bytes.
3. Configure the ignored environment from `.env.example`: database connection,
   server-only RPC and USD pricing provider, protocol file, exact browser origin,
   public operator addresses, fee receiver and approved refund EOA addresses.
   Keep credentialed provider URLs and private keys out of browser variables.
4. Copy `protocol.example.json` into protected operator configuration. Set the
   public creator, reviewed factory/type hashes, confirmations, per-vault premium,
   gas and subsidy ceilings. Keep API/worker chain, creator and limits consistent.
   The public protocol file contains no key, credential reference or RPC secret.
5. Start `npm run serve` on loopback, normally port 3201. Use TLS and request limits
   at the trusted edge. Preserve Cookie, Set-Cookie, Origin and X-Saffron-CSRF;
   never cache `/api/incentives`. Set the exact origin without a path. For a mount,
   build with `VITE_BASE_PATH=/incentives/` and serve with `BASE_PATH=/incentives`.
6. In Administration, authenticate an allowlisted operator, configure a verified
   pair and create a USD campaign. Assign explicit treasury inventory. Review the
   allocation against the named wallet's canonical holdings before enabling offers.
7. Configure and supervise the keyless watcher with a start block at or before
   the first supported payment. Complete its catch-up before opening intake.
8. Independently provision the creator's native gas and protected signing access.
   Choose reviewed or automatic operation, establish the staffing/funding service
   window, and open a bounded intake window through Administration.

The fee receiver must accept native ETH with commitment calldata. The user pays
exactly the quoted wei plus their network gas. No user message login is required.
Operator challenges last five minutes and are single-use. Wallet sessions last
30 minutes and use HttpOnly, SameSite=Strict cookies, Secure over HTTPS. A private
payment recovery capability restores the user session after expiry/API restart;
a public hash or claimed wallet address cannot restore authentication.

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

## Intake and abuse controls

Intake starts closed and expires after at most 24 hours. The operator specifies
mode, service window, pending-work limit and the supervised watcher ID. Readiness
requires a canonical watcher checkpoint checked within 15 seconds, no more than
32 confirmed blocks behind a head at most 60 seconds old. Automatic mode also
requires the queue worker heartbeat. Reviewed mode does not require that process.
Undelivered paid work beyond the service window closes intake; a delivered, fully
funded vault waiting for its user's deposit does not count as service non-delivery.

Payment review reserves campaign USD premium/fixed capacity, raw premium, queue
slots, treasury allocation and creator gas atomically. Public defaults are 10% per
campaign quote, 25% aggregate anonymous unpaid share and 32 global unpaid quotes,
with one unpaid checkout per browser. Tune the share/count policy via
`SAFFRON_CHECKOUT_POLICY`. Quote issuance is also bounded per browser, global
window and claimed wallet; new browser admission tokens are limited by direct peer.
Those identities are abuse signals, not Sybil resistance. Client-supplied forwarded
headers never authorize bypasses.

At the public edge, enforce per-client token/quote/review issuance limits and
request/body/concurrency limits. Log only counts, reasons and timing. Introduce a
bot challenge when issuance/rejection telemetry shows sustained automation. With
a shared reverse-proxy peer the application token limit is conservatively shared;
configure edge admission deliberately and do not trust arbitrary forwarded IPs.
Coordinated traffic can still saturate the bounded public pool. Alert, challenge
and pause intake; do not remove resource limits to hide that symptom. Larger
legitimate amounts use the unpaid review flow documented in TREASURY.md.

Prices are fresh at quote issuance; the separate mining deadline is 120 seconds.
Closing/expiry preserves the unpaid hold until the watcher proves a canonical
confirmed checkpoint beyond the deadline. Timely fees discovered later retain
admission; late/extra/incorrect-amount received fees enter the exception queue.
Closing a modal does not cancel a request or establish that no fee was received.

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

- `maxGasPerTx` and `maxGasPriceWei` bound each signature. Before checkout the API
  reserves their product for all three creation calls, a conservative ceiling.
- `maxDailyGasWei` bounds rolling 24-hour canonical actual gas plus unresolved
  exposure. Pending work retains exposure across the day boundary; canonical
  completion/retirement releases only unused ceiling.
- `maxSubsidyWei` bounds the positive difference between gas exposure/cost and
  retained fee revenue. Refund-due fees provide no projected credit. Zero subsidy
  is supported, although intake may then be unavailable with the configured bounds.
- `maxPremiumRaw` independently caps each vault's raw premium. Treasury and campaign
  limits still apply. Confirmation depth is at least two, consistent across services.

Replenish the creator's gas externally and verify the correct address/chain. ETH
collected at the fee recipient does not automatically fund the creator. Never
change a paid user's fee when gas rises: keep the original request paused until
its approved ceiling can execute, or resolve non-delivery explicitly. Account for
actual failed gas even when a fee is refunded.

## Alerts and payment exceptions

Administration and authenticated `GET /api/incentives/admin/status` expose safe
readiness reasons, gas/subsidy totals and operational metrics. Supervise process
liveness independently; a healthy process is not proof of canonical progress.

| Alert / metric | Required response |
| --- | --- |
| Watcher unavailable/behind/reconciliation | Keep new intake closed; repair RPC and resume the same cursor. Never skip payments. |
| Oldest paid request without progress / service-window breach | Inspect exact request, saved transaction and permit; execute bounded recovery or resolve non-delivery. |
| Funding backlog and age | Treasury reviews the refreshed brief and outstanding amount; partial funding remains pending. |
| Received fees awaiting resolution | Review the paginated payment queue and audit. Every received amount needs delivery or an explicit refund outcome. |
| Low creator balance, gas limit or subsidy exhaustion | Replenish/review externally; do not sign beyond limits or request an automatic fee top-up. |
| Reconciliation-required campaign | Pause execution/admission, restore canonical obligations and compare ledger totals. |
| Stale vault evidence | Retain request identity and disable chain-dependent entry until verified. |

For each received fee, review the actual amount and typed reason, including late,
duplicate, under/overpayment, policy block or creation failure. A failed payment,
self-transfer or wrong recipient does not establish received funds.

Operator decisions need the current row revision, a unique request key and a reason:

1. **Admit original request** keeps the same quote, deadline, payment and plan.
   Released resources must be acquired again atomically; immutable economics and
   current factory/gas/treasury checks still apply. The audited override reaches
   the worker's payment gate and can authorize at most the original job.
2. **Refund due** stops new creator signatures. Reconcile saved transactions and
   retire an original unused request before recording its refund. Partial created
   state and external premium/fixed recovery must be resolved, not deleted.
3. Execute the native refund externally from a configured `SAFFRON_REFUND_SENDERS`
   EOA to the original payer. Record its hash. Exact direct transfer evidence,
   canonical success, confirmation depth and unique allocation are mandatory.
   Contract-treasury internal transfers require a dedicated verifier and are not
   accepted by this direct-transfer verifier.
4. Partial refunds leave the remainder owed. Pending transfers reserve their
   amount. Reconcile replacements with the same sender/nonce and exact transfer,
   or a confirmed zero-value empty-data self-cancellation before sending anew.
   Orphaned refunds reopen reconciliation and pause unsafe admission.

Return received duplicate/excess fees and refund when the service cannot deliver
an original usable request, absorbing service-caused failed creation gas. Closing
the modal or choosing not to deposit after delivery does not itself prove a refund
is owed. Any discretionary refund is a separate audited decision. Resolving an
extra fee never releases the original campaign commitment. No refund is sent by
this application.

## Startup, pause, shutdown and restart

Start PostgreSQL, then UI/API/observer and keyless watcher. Verify catalog,
canonical cursor, inventory, gas and the selected execution mode before explicitly
opening intake. In reviewed mode, inspect/simulate and invoke only the selected
request. In automatic mode, start the protected queue worker before checking its
heartbeat. Use supervisor restart policies for API and watcher independently.

For planned downtime, first pause intake to stop new quotes. Continue the keyless
watcher to settle already offered payments, retain the observer and resolve saved
creator work. Stop signing gracefully at an operation boundary and preserve the
journal, leases and permanent permits. A timeout or forced stop does not prove a
transaction failed. Then stop remaining services as necessary; record unresolved
work for the next operator. Keep the watcher running whenever fees may still arrive.

Routine offer/pair changes affect new offers. A budget pause is an emergency stop
for new creation signatures and preserves paid obligations. Intake pause/expiry
alone stops new checkout without invalidating already paid requests. Restart with
the same state and signer; reconcile or rebroadcast saved bytes before new work.
Unknown consumed nonces require investigation. Do not delete a journal or reset a
permit to force another vault. Confirmed exact replacements or zero-value self
cancellations use the existing operator recovery route. An exhausted one-request
permit stays terminal; use bounded keyless retirement and payment resolution.

If PostgreSQL is unavailable, the API returns generic unavailable responses and
retries shared initialization after a five-second backoff. Connection setup is
bounded; recovery does not require an API restart. Never turn an unavailable DB
or RPC into empty positions or released capacity.

For binary rollback, retain all new quotes, fees, transactions, permits and ledger
evidence. The bootstrap targets new databases; an older binary/schema must be
reviewed for compatibility before use. Never substitute a clean queue for current
recovery state.

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
`inspect` compares saved nonces, exact transactions/receipts, fees/refunds, watcher
cursors, vault observations and raw ledger totals with fresh canonical chain data.
The public report always has `activationAllowed:false`.

Even `recordedEvidenceMatches:true` compares only records present in the restored
database. Matching creator nonces do not prove that all later quotes or received
fees are present. The checker cannot reconstruct missing recovery commitments,
signed bytes or one-request permits. Audit backup/WAL completeness and the exact
signer history, reconcile later fee/treasury activity, and resume canonical scans
from the preserved start block. Unknown or missing later state keeps signing and
intake stopped until complete recovery is available. Never override a nonce mismatch
by deleting rows or advancing the scanner start.

After evidence recovery, reconcile each campaign through the operator controls,
verify inventory and gas again, review protected permits and unresolved fees, then
explicitly reopen campaigns and a new bounded intake window. Reconciliation does
not unpause automatically. Deployment/receipt reorgs restore obligations and may
exhaust capacity; retain the pause until the ledger and chain agree.

`npm run test:restore` exercises real pg_dump/pg_restore against two disposable
databases. A source vault created after the backup makes restored signer evidence
mismatch, and a restored worker sends nothing. This proves the tested duplicate
creation guard, not the completeness of an operator's live backup procedure.

## Release evidence

Run README's verification commands, review the public acceptance artifact and
release UI/API/worker/config together. Lab and static preview are separate outputs;
neither authorizes production signing. Preserve packaged source notices/licenses.
The creation-only live vault record remains distinct from a separately authorized
live fee, funding, LP deposit, claim and final withdrawal acceptance run.
