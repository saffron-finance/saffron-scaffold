# Saffron liquidity incentives and Live APR

Version 0.3.0 provides Home, Portfolio, Live APR and the full fixed-side vault
journey in one standalone interface. Its canonical API, database, watcher and
creator are maintained in this repository's `liquidity-incentives` package.
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
| `npm run build` | `dist/` | Explicit browser simulation | No |
| `npm run build:lab` | `dist/` | Explicit browser simulation | Yes |
| `npm run build:live` | `dist-live/` | Wallet and canonical API | Optional |

Live mode is selected at build time. It never switches to samples after an API
failure. APR uses the separately configured read-only v2 gateway in either mode.
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
  the separate creation fee: $2 equivalent in native ETH on Robinhood, paid to
  the recipient frozen by the backend quote. User message signatures are not
  required; wallet transactions still require explicit confirmation.
- Canonically accepted fees enter automatic creation. Four verified stages cover
  adapter, vault, initialization and external premium funding. The application
  shows elapsed time and real progress without inventing a delivery estimate.
- Full canonical premium funding enables fixed-side LP entry. Portfolio provides
  deposit, incentive claim, ownership recovery and mature withdrawal.
- **Vault TVL** values the current deposited principal in each campaign's vaults.
  It excludes premium and requested capacity, and reports unavailable/stale data.
  APR's separate **Pool TVL** retains its pool-wide meaning. Preview values are
  explicitly samples.
- Campaigns remain database-managed after launch. Private advisory targets do
  not cap user requests. Quote economics freeze; new terms require a new program.
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

Home is `/`; Portfolio is `/portfolio/vaults`; Campaigns and Administration are
`/campaigns` and `/admin`. `/live-apr` opens the default pool, with pool IDs and
up to three `compare` parameters supported. Stats/Community are scaffold pages.
The public vault journey never requires navigating to another application.

Browser payment records retain private recovery capabilities and known
transaction outcomes across reloads and tabs. Shared requests and canonical
observations belong to the API/database. A browser return refreshes ownership
and chain state without automatically confirming a wallet action.

The preview alone uses `saffron.live-apr-merge.campaign-preview.v1`; Reset preview
only resets that simulation. APR receipt ownership is separate: route departure
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

For preview browser checks, run `npm run build:lab`, set `MERGE_BASE=/` for a root
build, then `npm run test:browser`. The harness uses explicit wire fixtures and
checks responsive UI, actual PNG pixels, simulation and recovery state.

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
