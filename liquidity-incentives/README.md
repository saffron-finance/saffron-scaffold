# Saffron Scaffold — liquidity incentives

Standalone, beta-styled, admin-managed LP incentive offers and paid vault requests. This package
is isolated from the scaffold root application and its read-only Pages build.

## Run locally

Node 22+ and npm are required. No sibling checkout or hosted account is needed.

```sh
cd liquidity-incentives
npm ci
npm run build:lab
npm run serve
```

Open http://localhost:3201. The reviewed typography defaults and optional font
controls are enabled by `build:lab`. `npm run build` excludes the dev controls
and their fonts. For hot reload run `npm run dev` alongside the server, then
open http://localhost:5187.

Configure `RPC_ROBINHOOD` server-side to load the live pool price. Ethereum and
Arbitrum have public read-only RPC fallbacks. Never put credentialed RPC URLs in
browser-prefixed variables. The server proxies only allowlisted read methods
and fixed-host public prices for catalog quote tokens (plus legacy ETH/USDG aliases).

Payments stay disabled until the request database is healthy and an operator
sets `VAULT_REQUEST_PAYMENT_ADDRESS`. Do not enable payment collection merely
to review the UI. A submitted fee is real: 2 USDC or a quoted native ETH amount
on Arbitrum, followed by a wallet signature. The requested LP vault is on
Robinhood. No LP principal moves and no premium is paid during this request.

ETH fees must be mined before their 15-minute quote expires. Verification uses
the canonical payment block time, so an on-time payment can still be resumed
after expiry. A late ETH payment needs operator review; retain the receipt and
do not pay again. The fixed 2 USDC fee remains recoverable after quote expiry.

### PostgreSQL

Use a dedicated database and role; configure `SAFFRON_DB_HOST`,
`SAFFRON_DB_USER` and `SAFFRON_DB_NAME` (defaults: local Unix socket and
`saffron_incentives`). Standard pg environment configuration applies for
operator-managed authentication. No credentials or request records are included.

`server/pending-vaults.sql` installs the fixed-income-compatible
`uniswap_v3_fiv.pending_vaults` table. Units remain seconds for duration, cents
for USD capacity, and a decimal ratio for APR. Target-APR requests keep
`variable_asset_amount = NULL`. The user's deposit is distinct from offer
capacity and is preserved in the signed snapshot.

The `liqifi` evidence/quote sidecar schema and existing receipt/storage names
are deliberately preserved for migration compatibility; do not rename them
without a migration. Existing JSON receipts can be imported through the
operator-only `VAULT_REQUEST_STORE_PATH`. No hosted data is included or accessed
by default. Admin listing checks the selected chain's factory owner signature.

If database initialization or legacy import fails, the next request after a
five-second cooldown retries initialization. Concurrent requests share that
attempt, and payments stay disabled until schema setup and import finish.

### Admin-managed incentive catalog

Open **My requests → Manage incentive programs → Load incentive catalog** with
the Robinhood Chain `VaultFactory.owner()` wallet. Loading and saving each edit
require a fresh wallet signature. Write signatures bind the complete edit,
operation, wallet, chain, nonce, and expiry; a request-list signature cannot
authorize a catalog change. The server rechecks current ownership on execution.

`server/incentive-programs.sql` adds two related tables:

- `liqifi.incentive_pairs`: pool address, token addresses/symbols/decimals, fee
  tier, and active state. Multiple programs can share one pair. New and edited
  pairs are checked against the configured Robinhood RPC before they are saved.
- `liqifi.incentive_programs`: stable ID, pair ID, APR, duration, proposed USD
  capacity, display order, NEW badge, and active state.

The former CASHCAT/ETH pair and four offers are bootstrap rows. Initialization
does not overwrite existing edits or pauses. Each row records its revision,
last editor, and update time; stale concurrent edits fail with a reload message.
Pause rows to remove them from the public catalog. Pausing a pair hides all its
programs. Rows are retained, and their IDs cannot be changed in the editor.

The public page loads `/incentive-programs`, groups offers by pair, and uses
token addresses for prices. There is no fallback offer array. Loading, empty,
and unavailable states remain distinct, with receipt recovery and administration
available in all three states. This release supports full-range programs on
Robinhood; token artwork is optional and unknown tokens get a local fallback.

New `/vault-requests/quote` calls include the reviewed request details. The
server checks the current active program before issuing a fee quote and stores
that snapshot in `liqifi.request_fee_quotes.request_details`. Subsequent saves
must match it, even if an administrator edits or pauses the program meanwhile.
Existing quotes and legacy receipts retain their original verification format.
Catalog capacity is proposed capacity, not a funded balance or reserved budget.

### Mounting beneath a path

Build with `VITE_BASE_PATH=/incentives/` and serve with
`BASE_PATH=/incentives`. These values must agree. Static assets, 3D emblem,
prices, RPC and request endpoints resolve beneath the mount. The production
server binds loopback by default; TLS and access policy belong to the operator.
No deployment-specific configuration is part of this package.

## Feature boundary / later fixed-income merge

| Directory | Purpose | Merge treatment |
| --- | --- | --- |
| `src/incentives` | Catalog presentation/editor, quote math, rows, two-step modal, summary | Port as the feature |
| `src/host` | Standalone wallet, API, theme and scene adapters | Replace with destination providers |
| `src/adapters` | Explicit injected-wallet selection and chain metadata | Reuse destination equivalents |
| `shared` | Versioned request messages and validation | Preserve signed-message bytes |
| `server` | Verification, pending database, oracle quotes, read-only relay | Integrate with existing backend |
| `vendor/fixed-income-ui` | Small pinned UI snapshot | Replace with shared imports |
| `src/dev` | Optional typography controls | Exclude entirely |

The deposit field uses fixed-income's currency formatter and field styles.
`Your deposit` sums both unrounded LP legs. `You get` shows the actual yield
token and estimated USD premium at the current price. Continue freezes those
terms before payment. Payment recovery and replay checks prevent retrying from
charging twice; changed transaction hashes are retained before later RPC reads.
A confirmed zero-value self-cancellation can be cleared to start a new request,
including after reload. Reverts and cancellations are checked against the
canonical block before clearing is allowed; uncertain payments remain resumable.

Use **Save request receipt** in the payment/review dialog to download recovery
data. To restore it in another browser, open **My requests** and choose
**Import receipt** below the list (**Import your receipt** when the list is
empty). Import remains available while disconnected or if the list cannot load.
The saved terms open for review; connect the wallet named in the receipt and
resume without another fee. Import validates the file and any existing signature,
preserves legacy terms, and never replaces an unfinished request. Payment and
fee-quote verification still occur when resuming; an imported file alone does
not establish payment. For v3 receipts, the server's original fee quote must
still be available.

The UI snapshot and exact emblem assets originate from Saffron fixed-income
revision `dc104999f531611f2b5b772d3b72cc3ad8c2ed23`. See
[vendor provenance](vendor/fixed-income-ui/README.md). This package does not
contain the fixed-income monorepo or require it at build time.

## Verify

```sh
npm ci
npm run build:lab
npm test
npm run test:database
npm run test:browser
```

Browser and database tests need local PostgreSQL with a dedicated CREATEDB test
role. Configure `SAFFRON_TEST_DB_HOST` and `SAFFRON_TEST_DB_USER` (default
`saffron_incentives_test`). Each test creates/drops its own randomly named
`liqifi_test_*` database; never configure these tests against a live database.
Install the matching Chromium once with `npx playwright install chromium`.

Checks cover formatted/cleared/over-capacity deposits, live-price changes,
canonical signed amounts, USDC and ETH fee flows, pending/admin views, cancelled
signatures, receipt export/import, reload recovery, keyboard/mobile layout and
relay rejections.
Wallets are freshly generated and unfunded; RPC and signatures use deterministic
fixtures. Tests do not send funds. Installed-wallet acceptance remains manual.

Known review limitations remain: these are proposed programs, so displayed
capacity is not funded LP TVL; production integration still needs the target
app's auth/status workflow. This export preserves the reviewed prototype, not
a claim of completed fixed-income integration.

### Export verification — 2026-09-08

- 67 API/adapter/relay tests, 12 PostgreSQL tests and 6 browser dry runs passed.
- Normal and review builds passed; normal build excludes dev controls/fonts.
- Root scaffold live/mock builds passed; its mock remained RPC-free.
- `/incentives/` hosting, exact 3D assets and request modal passed in-browser.
- Source scan found no private deployment paths, credential markers or outputs.
- No live payments, live database changes or production deployment performed.

After the cancellation, ETH quote-expiry and database startup-retry fixes,
70 API/adapter/relay tests, 18 PostgreSQL tests and 7 browser dry runs passed.
Normal/lab and root live/mock builds also passed; the root mock remained
read-only with zero RPC requests.

Receipt import verification on 2026-09-09: 73 API/adapter/relay tests,
18 PostgreSQL tests and 13 browser dry runs passed, along with normal/lab and
root live/mock builds. Browser checks cover actual downloaded files, storage
loss, signed retries, legacy terms, invalid files, wallet conflicts, existing
pending requests, unavailable lists and disconnected mobile recovery.

Catalog verification on 2026-09-09: 73 API/adapter/relay tests, 25 PostgreSQL
tests and 17 browser dry runs passed. Coverage includes owner-only catalog
administration, signed edits, stale revisions, verified pair metadata, paused
programs, persistent bootstrap data, catalog outages, and paid recovery after
catalog changes. Normal/lab and root live/mock builds passed; the root mock
performed no RPC or wallet calls. All database and payment checks used
disposable PostgreSQL databases and unfunded wallet/RPC fixtures.
