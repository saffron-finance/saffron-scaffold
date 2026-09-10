# Saffron Scaffold — liquidity incentives

Standalone, beta-styled, admin-managed LP incentive offers and paid vault requests. This package
is isolated from the scaffold root application and its read-only Pages build.

## Run locally

Node 22+ and npm are required. No sibling checkout or hosted account is needed.
`npm ci` and `npm run build:lab` need no shell-specific configuration.
Keep optional dependencies installed for native EVM tests; the fixture selects the
pinned Anvil binary for the current operating system and architecture.

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
`variable_asset_amount = NULL`. Each vault is sized to the user's selected
deposit, converted exactly to integer USD cents. The catalog's capacity is the
maximum permitted size per request; it is not the size of every resulting vault
or a reservation against an aggregate program budget.

`server/vault-sizing.sql` repairs the former catalog-sized projection only for
untouched pending incentive requests. Reviewed, manually resized and created
rows are preserved. `request_payments.sizing_version` makes this repair run once
per old row. Signed receipts, fee quotes and payment evidence never change.
New quotes require whole cents; legacy sub-cent receipts can still be recovered
but require manual sizing review before a vault can be created.

The `liqifi` evidence/quote sidecar schema and existing receipt/storage names
are deliberately preserved for migration compatibility; do not rename them
without a migration. Existing JSON receipts can be imported through the
operator-only `VAULT_REQUEST_STORE_PATH`. No hosted data is included or accessed
by default. Admin authorization uses an explicit server-side test-operator allowlist.

If database initialization or legacy import fails, the next request after a
five-second cooldown retries initialization. Concurrent requests share that
attempt, and payments stay disabled until schema setup and import finish.

### Admin-managed incentive catalog

Open **Admin queue → Sign in as operator → Manage incentive programs** with
an address in `SAFFRON_ADMIN_WALLETS`. Loading and saving each edit
require a fresh wallet signature. Write signatures bind the complete edit,
operation, wallet, chain, nonce, and expiry; a request-list signature cannot
authorize a catalog change. The server rechecks its operator allowlist on execution.

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

### Native request → creation → funding → deposit

Maze's four handoff commits are retained in Git history; their redirects are replaced.

- `/admin/requests`: allowed operators sign in once per 30-minute session; Create
  queues one durable job. The separate local worker creates the full-range adapter,
  creates the vault, and initializes it on Robinhood using the unrestricted factory.
- Admin premium funding is a second explicit approval with the exact raw budget.
  Creation alone never approves spending that premium.
- `/portfolio/requests`: wallet-filtered rows refresh every 5 seconds. Creation is
  separate from eligibility. Only initialized, verified, unoccupied vaults with
  full bearer supply and covered premium balance become **Depositable**.
- Deposit opens the same `VaultReview` body as the front-page modal's second page.
  The user's selected wallet wraps ETH if needed, approves LP tokens to the verified
  adapter, then calls the fixed side. There is no second request fee or user variable action.
- `/vault-requests/handoff` returns 410. No legacy app/API URL configuration remains.

The queue remains `uniswap_v3_fiv.pending_vaults`; receipts and catalog data retain
Maze's schema. `server/vault-lifecycle.sql` adds private transaction/job and read-only
observation sidecars. Both standalone and existing fixed-income schema modes work;
no fixed-income frontend, router, indexer, or runtime is required. Existing external
schema owners retain their table/trigger ownership.

Read [operator setup and rollback](ops/README.md) before enabling the worker.
The worker defaults off; the HTTP server never holds the creator key or sends transactions.
A stale terms digest conflicts. Legacy sizing mismatches require explicit approved
USD cents and a review reason, saved separately without altering signed receipts.

### Mounting beneath a path

Build with `VITE_BASE_PATH=/incentives/` and serve with
`BASE_PATH=/incentives`. These values must agree. Static assets, 3D emblem,
prices, RPC and request endpoints resolve beneath the mount. The production
server binds loopback by default; TLS and access policy belong to the operator.
No deployment-specific configuration is part of this package.

## Standalone sidebar and appearance preview

Approved appearance (9 September): sidebar and offer cards use `#0a0a0a`
with a `#1d1d1d` border against the unchanged black page canvas. Card hover is
neutral gray. The sidebar uses the screenshot's purple Afterglow palette,
150° button / 180° surface directions, 70% highlight, 75% border, 27% glow,
29px spread, 12px radius/padding, 6px spacing and 20px icon size. Navigation
icons are off; the active indicator remains on. Canonical colors/settings are
in `src/host/sidebarTheme.ts`. The static approved paint is shared by normal
and preview builds; optional styles stay isolated in `src/dev/`.

The standalone shell uses a reference-style dark sidebar with one spinning
Saffron emblem. Vaults is selected by default and stays within the current
mount. Tokens, Fixed yield, Variable yield, and Stats open existing protocol
pages; Audits and Community open the existing documentation and Discord links.
`VITE_PROTOCOL_APP_URL` optionally replaces the default public protocol origin
at build time. Request, admin (where available), and wallet actions remain in
the host menu. No backend, wallet signing, or request behavior changed.

The sidebar is 252px wide (220px below 1100px), becoming a scrollable top
navigation at 1000px and below so the existing vault rows keep enough room.
`src/host/Sidebar.tsx`, `sidebarNavigation.ts`, and `sidebarTheme.ts` belong to
this standalone adapter, not the mergeable incentive feature.

In `build:lab`, **Tweak → Sidebar appearance** controls background top/bottom,
active gradient start/end, navigation text, gradient direction, and glow.
Changes apply to the sidebar only and are saved locally under
`saffron.staging.sidebar.v1`; **Reset sidebar** restores the approved purple defaults.
Only validated hex colors and bounded numbers are restored. Normal builds
include the default sidebar but omit this preview UI and its persistence.
Existing APR motion controls remain independent (3.5× page default, 1.5× modal).
No new runtime dependencies were added.

The square left-arrow button hides the rail and releases its width. The same
44px WebGL logo becomes a floating **Open sidebar** control; clicking it or
pressing Enter/Space reopens the navigation. Neither the logo nor the incentive
page is remounted. Focus transfers to the visible control, including on mobile;
reduced motion disables the short pop animation. Collapse is per page visit.

**Button style** now defaults to the approved purple Violet afterglow and still offers ten sunset presets:
Classic sunset, Purple dusk, Ember glass, Golden horizon, Violet afterglow,
Sunset outline, Sunset silk, Saffron aurora, Molten edge, and Sunset orbit.
Presets affect the active button and hover; **Style all buttons** also applies
the treatment to idle buttons. Colors, gradient/background direction, highlight
and border strength, glow/spread, corner radius, padding, row spacing, icon
size/visibility, and the active indicator can be adjusted independently. Orbit
has its own speed control and respects reduced motion. These optional presets
stay in `src/dev/sidebarPresets.ts`; normal builds omit the optional presets; only the approved Afterglow paint is shared with the host.
The September 9 approved design replaces older auto-saved appearance values once;
subsequent Tweak choices persist. Reset sidebar restores the approved design.

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

With an installed sibling fixed-income checkout, additionally run
`npm run test:lifecycle` (or append `-- /path/to/fixed-income`). This optional
suite loads that checkout's actual request route, DB service, API projection,
signature verification and URL decoder against a disposable PostgreSQL
database. Only the PG connection plumbing, logging/notification transport and
chain reads are fixtures. It checks that the same request is visible, rejects
a non-owner completion, then completes it and opens both vault-side URLs. It
does not claim to execute real vault-creation or deposit transactions. For that
next layer use fixed-income's fork + local-stack harness, with both APIs reading
the same fork and queue.

Browser and database tests need local PostgreSQL with a dedicated CREATEDB test
role. Configure `SAFFRON_TEST_DB_HOST` and `SAFFRON_TEST_DB_USER` (default
`saffron_incentives_test`). Each test creates/drops its own randomly named
`liqifi_test_*` database; never configure these tests against a live database.
Install the matching Chromium once with `npx playwright install chromium`.

Checks cover formatted/cleared/over-capacity deposits, live-price changes,
canonical signed amounts, USDC and ETH fee flows, pending/admin views, cancelled
signatures, receipt export/import, reload recovery, keyboard/mobile layout and
relay rejections.
Payment tests use generated unfunded wallets/RPC fixtures. Native lifecycle tests
execute pinned protocol bytecode on an isolated local Anvil chain with valueless
test tokens and a position-manager double. No public-chain transactions are sent.

The funding gate is app-level, not an on-chain reservation or atomic premium lock.
Admin withdrawals, competing deposits or reorgs can change availability until mining.
Live acceptance requires separately provisioned signing, creation and full premium
funding; do not infer that milestone from fixture tests.

### Native checks

```sh
npm test
npm run test:database
npm run test:lifecycle
npm run build
npm run test:browser
```

Database/browser/lifecycle tests require a disposable PostgreSQL admin role (see
above). `test:lifecycle` uses the dev-only Anvil binary and Solidity compiler.
`tests/protocol/SOURCE.md` records the pinned source and fixture limitations.
Historical verification below describes earlier commits, not the current release.

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

Vault sizing/handoff/entry verification on 2026-09-09: 80 API/adapter/relay
tests, 28 PostgreSQL tests, 21 browser dry runs and the optional integration
test against fixed-income's actual route/provider/DB service passed (130 total).
Coverage includes exact selected capacity, conservative legacy migration,
shared-schema ownership, owner-signed completion, both vault-side destinations,
return navigation, mobile layout and retryable handoff failures. Normal/lab and
root live/mock builds passed. The root mock's filters, sorting, pagination,
icons and ranges rendered with zero RPC or wallet calls. No real creation or
deposit transaction, production database change or deployment was performed.

### Native lifecycle implementation — 2026-09-09

- 81 API/adapter/relay/auth/math tests, 28 database regressions, 3 Solidity-EVM
  lifecycle tests and 18 browser checks passed (130 total; reruns excluded).
- Feature and mounted candidate builds plus root live/mock builds passed. Root
  mock filters/sorting/pagination/icons/ranges remained RPC- and wallet-free.
- Browser flow includes real local Solidity creation/funding/fixed deposit,
  one-base-unit-short gating, native modal reuse, and lost-response/reload recovery.
- Read-only live factory inspection matched vault type 1 and full-range type 2
  against the protocol's recorded init-code hashes. No public-chain writes occurred.
- Hosted activation still requires the operator's public allowlist address and
  separately provisioned protected EOA. Fixture success is not live acceptance.
