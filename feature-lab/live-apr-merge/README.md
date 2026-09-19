# Saffron liquidity incentives and Live APR

Version 0.8.31 adds bounded browser/resource security regressions and portable test lanes.
See [testing policy](docs/testing-policy.md) and [proposal registry](docs/test-contract-catalog.json).
Catalog entries are proposals, not a claim of 748 executable tests.

Version 0.8.10 coordinates wallet recovery across tabs and isolates payment/session
outages from healthy vault rows. See [recovery isolation](docs/wallet-recovery-isolation.md).

## Version 0.8.9 — frontend-only release

Contains optional 3D-logo and appearance-editor download failures locally,
preserving static branding and the usable application. Adds outer shell and
pre-JavaScript recovery without clearing saved requests or retrying transactions.
See [download recovery](docs/download-recovery.md) and `test:downloads`.

Keeps intake form fields bound to the saved policy revision. Existing watcher
and service settings initialize the form; concurrent operator changes require
an explicit reload/review, never a silent merge into a newer revision. Pause
preserves saved settings. See [intake editing](docs/intake-policy.md).

Bounds silent wallet preflight reads to 15 seconds, releases the shared wallet
lock on timeout or close, and ignores late results. Preparation remains
cancellable until the actual provider-send boundary, including viem's final
internal chain read. Durable recovery and zero-retry wallet writes are retained.
See [wallet preflight](docs/wallet-preflight.md) and `test:wallet-preflight`.

Adds an operator-only deployer ETH balance card to Administration and Incentive programs.
It uses optional `walletBalance` metadata on the existing `server-gas` health
check; older backends show Unavailable, never an invented zero. No new RPC
polling or homepage administration is introduced.

Makes Back immediate while unpaid quote cleanup runs independently, preserving
recovery and serializing subsequent reviews. The isolated `test:checkout-navigation`
suite holds API responses to verify rapid edits, failed cleanup and safe payment.

Retains token-pair/reward progress titles, collapsed deployment diagnostics and
expandable claim errors beneath the action. Retains the linked impermanent-loss
disclosure and concise request-fee review.
Includes the responsive header and mobile cards, wallet/modal redesign, admin
wallet funding and paused-program withdrawal UI, nonblocking checkout, removal
of exact USD preview/quote matching, and bounded browser price/catalog refreshes.
Server, worker, operator-console and signer-import implementations are deliberately
not part of this update. Runtime credentials and host configuration are excluded.

See [frontend compatibility](docs/FRONTEND-0.8.0.md) before pairing this UI with a
backend. Older server sources in this repository are historical, not a claim
that the separately maintained production backend was published here.

## Historical 0.7.0 baseline

Version 0.7.0 adds an operational Status page, startup/Journey Guide, and a focused
Administration console with intake summary, metric cards, request filters, and
separate incentive program/payment/refund sections. Operator navigation orders
**Administration → Status → Journey Guide**, on desktop and mobile.

Status uses the wallet-gated canonical `/admin/health` endpoint. It distinguishes
an enabled intake switch from effective checkout readiness, displays individual
subsystem failures and next actions, and keeps unverifiable items unknown.
Creator gas, external premium coverage, backups and staffed support are manual
checks, never an automatic green light. The API cannot start or provision a signer.
Use `npm run test:status` after a root build with the canonical backend's disposable
database test environment; `MERGE_BASE_PATH` also exercises a nested build.

Visible configuration warnings remain on Admin and Incentive programs.
Missing/invalid server settings show their names, impact, and corrective action
after wallet-signed operator login; secret values are never returned. Optional
WalletConnect and automatic network setup are labeled separately. PostgreSQL
defaults do not trigger false alarms. An unavailable check is not a healthy
result. The check does not open intake or test worker/network availability.

The application provides Home, Portfolio, Live APR and the full fixed-side vault
journey in one standalone interface. Its historical API, database, watcher and creator baseline is in the
`liquidity-incentives` package; the 0.8.0 backend extensions are maintained separately.
Vendored sources and licenses are included; no other application is a build or
runtime dependency. Historical adoption revisions remain in the provenance files.

## Install and build

Use Node 22.9 or newer, npm and HTTP(S):

```sh
npm ci
npm run dev
```

| Command | Output | Incentive behavior | Appearance controls |
| --- | --- | --- | --- |
| `npm run build` | `dist/` | Wallet and canonical API | No |
| `npm run build:lab` | `dist/` | Wallet and canonical API | Yes |
| `npm run build:live` | `dist-live/` | Wallet and canonical API | Optional |

Every build uses the same wallet/API path, including local-chain tests. None
switches to samples after an API failure. APR uses its separate read-only gateway.
A static host alone cannot provide live incentives. Build output does not prove
which version is deployed or whether paid intake is open.

Put public settings in `.env.local`, using `.env.example` as a starting point:

```dotenv
VITE_BASE_PATH=/
VITE_LIVE_APR_API_BASE=/api/live-apr/v2
VITE_UI_TWEAKS=false
```

Use the actual mounted path when hosting beneath a prefix. Frontend
`VITE_BASE_PATH` and backend `BASE_PATH` must agree. Serve live output using the
backend's `DIST_DIR`; it handles incentives API, read-only RPC and prices before
SPA fallback. Keep the APR route separately proxied with its existing session
boundary. Never put RPC or signer credentials in frontend settings.

## Current product behavior

- Mobile Home, Portfolio, APR navigation and transaction dialogs share compact
  controls and safe-area spacing. Desktop navigation remains available.
- **Claim $X** retains its request-time incentive value. Review explicitly shows
  the separate creation fee: the incentive program’s fixed amount in native ETH on Robinhood, paid to
  the recipient frozen by the backend quote. User message signatures are not
  required; wallet transactions still require explicit confirmation.
- Canonically accepted fees enter automatic creation. Four verified stages cover
  adapter, vault, initialization and external premium funding. The application
  shows elapsed time and real progress without inventing a delivery estimate.
- Full canonical premium funding enables fixed-side LP entry. Portfolio provides
  deposit, incentive claim, ownership recovery and mature withdrawal.
- **Vault TVL** values the current deposited principal in each incentive program's vaults.
  It excludes premium and requested capacity, and reports unavailable/stale data.
  APR's separate **Pool TVL** retains its pool-wide meaning.
- Incentive programs remain database-managed after launch. Private advisory targets do
  not cap user requests. Premium economics freeze; new premium terms require a new
  program. A fixed ETH request fee (`requestFeeWei`) is required per program, with
  no dollar peg or default. Fee edits apply only to new quotes; original payments
  and refunds retain their quoted amount. Old incentive programs without a fee stay paused.
- Operator refund administration prepares exact full-fee manifests and verifies
  externally paid refunds before permanently closing unfulfillable requests.
  The app does not sign refunds or expose a public variable-side deposit form.
- Live APR keeps its pool picker, four-pool comparison, history and PNG export.
  Gateway failures show **APR unavailable** and stale observations while safe
  vault actions use their independent readiness checks.

## Mobile wallet support

WalletConnect supports wallet-app links on mobile Safari/Chrome and QR pairing
from desktop. Set the public `VITE_WALLETCONNECT_PROJECT_ID` before a live build;
without it, the picker retains injected wallets and wallet browsers. The chosen
wallet must support Robinhood Chain (4663) and transaction requests.

Pairing asks for connection permission, without a message-signing login. Returning
from the wallet refreshes accounts and chain state, and restores an accepted
session on reload without sending a payment. Disconnect ends the WalletConnect
session while retaining this browser's payment recovery records.

See [WalletConnect setup and qualification](docs/WALLETCONNECT.md) for project
origins, cancellation, mobile return behavior and the real-device acceptance gate.

## Routes and durable state

Home is `/`; Portfolio is `/portfolio/vaults`; Incentive programs and Administration are
`/campaigns` and `/admin`. `/live-apr` opens the default pool, with pool IDs and
up to three `compare` parameters supported. Stats/Community are scaffold pages.
The public vault journey never requires navigating to another application.

Browser payment records retain private recovery capabilities and known
transaction outcomes across reloads and tabs. Shared requests and canonical
observations belong to the API/database. A browser return refreshes ownership
and chain state without automatically confirming a wallet action.

Old browser simulation storage is ignored and cannot connect a wallet, create
an incentive program or submit a request. APR receipt ownership is separate: route departure
releases it, while suspended-document recovery reuses it when recognized.

## Verification and handoff

```sh
npm run check:upstream
npm run test:source
npm run test:release
npm test
npm run typecheck
npx playwright install chromium
npm run build:live
npm run test:apr-http
```

The source check compares all 32 exact copied files with their pins and, when
available in this repository, the canonical backend. It normalizes CRLF to LF
only. A portable frontend archive verifies without a backend checkout.

For UI browser checks, build at `/`, set `SAFFRON_BACKEND_SOURCE` to the canonical
package and configure disposable `SAFFRON_TEST_DB_*`, then run `npm run test:browser`.
The harness uses a real API/database/local EVM and generated wallet. Only read-only
APR observations use wire fixtures. It checks wallet gating, exact incentive program fee
editing, responsive layout and actual PNG pixels.

For the real API/database/disposable-chain journey, follow
[lifecycle acceptance](docs/LIFECYCLE-ACCEPTANCE.md). Run both `MERGE_DEVICE=mobile`
and `MERGE_DEVICE=desktop`; the backend test dependencies are needed only for
these integration checks. [APR acceptance](docs/APR-ACCEPTANCE.md) distinguishes
controlled HTTP evidence from required deployed gateway qualification.

After final source changes:

```sh
python scripts/render_install.py
python scripts/package_source.py validation/live-apr-merge-source.zip
python scripts/verify_source.py validation/live-apr-merge-source.zip
```

The guide renderer uses only Python's standard library and the included HTML.
The packager also uses Node's built-ins. `source-files.json` defines the inventory;
archives exclude runtime settings, dependencies, build output and other ZIPs.
`source-manifest.json` records exact file hashes, package version, Git revision
and normalized source digest. Extract with the verifier's `--extract` option
into a new directory, then verify/install/build there. Source changes, including
line endings, are checked against exact archive hashes; shared import checks
separately allow checkout line-ending differences.

Use the served-release preflight and non-spending browser check described in
[cutover](docs/LIVE-CUTOVER.md), with the actual mount and approved source manifest.
[Release acceptance](docs/RELEASE-ACCEPTANCE.md) records the separate launch gates.

See [deployment](docs/DEPLOYMENT.md), [cutover](docs/LIVE-CUTOVER.md), the
[historical adoption map](docs/PRODUCT-SYNC.md) and the included installation
page. The release marker and source manifest identify a candidate; they do not
activate intake, publish files, qualify a real phone or perform live transfers.

## Incentive program and pair setup

In Admin → Incentive programs, choose a pool, enter its fixed ETH request fee, duration
and economics, then create the incentive program. IDs are assigned automatically, and
headings show pool tokens and fee tier. A stable creation key prevents duplicates
when a save response is lost. Existing incentive program IDs and quotes do not change.

Add pair follows the fixed-income Create Vault token-step interaction: two
searchable modal selectors, a swap button, and existing Uniswap fee tiers. The
first token is the reward token; ETH pools use the WETH contract. Search names
or symbols, or paste an ERC-20 contract address. Token addresses distinguish
duplicate symbols. Saving reads and verifies pool and token metadata on Robinhood.

No paid CoinGecko API or key is required. The API uses the public Robinhood token
list with a bundled WETH/USDG/SFI fallback and supports direct RPC address lookup.
An unavailable token list does not enable sample data or bypass wallet login.
All discovery endpoints require a wallet-authenticated operator session.

Selected token addresses link to their Blockscout token pages, even without a
matching pool. The selected pool links to Uniswap Explore on Robinhood. Fee-tier
controls have persistent gray outlines; USDG uses its bundled, address-bound icon.

Incentive program Range selection is displayed as a read-only `Infinite range` field;
the current full-range adapter and incentive program API payload are unchanged.

Homepage pair headers, yield icons, and token tooltips also resolve USDG by its
Robinhood address to the bundled icon, without external API access.
