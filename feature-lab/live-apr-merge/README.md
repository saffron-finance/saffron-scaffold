# Saffron Live APR merge

Version 0.2.3 integrates watcher-app product changes through `19ad0e9` into the
approved merged frontend. The standalone incentives baseline was `93fcab6`.
The Live APR feature remains pinned to `b8eb411`.

## Build modes

| Command | Output | Incentive requests | Tweak controls |
| --- | --- | --- | --- |
| `npm run build` | `dist/` | Browser-only samples | No |
| `npm run build:lab` | `dist/` | Browser-only samples | Yes |
| `npm run build:live` | `dist-live/` | Actual wallet and canonical API | No |

The published Feature Lab page uses **build:lab**. Its APR observations are live
read-only data. Its vault requests use no real funds. Live mode is explicit at
build time, never a query-string switch or an error fallback. It requires the
separate canonical backend; copying its files onto a static host is insufficient.

## Product changes

Version 0.2.3 implements the approved mobile **Home** concept below 600px:
compact Saffron/Connect header, short introduction with How it works, compact
pair/network heading, APR-first cards, side-by-side Duration/TVL and a fixed
Home/Portfolio/Live APR/More bar with safe-area spacing. More uses the existing
menu and includes secondary destinations, source links and preview controls.

Only Home is redesigned. Other destinations and incentive modals keep their
current layouts; desktop/tablet geometry at 600px and above is unchanged.
Desktop Tweak preferences stay saved but do not alter the phone cards or cover
the bottom navigation. Payment recovery, loading/empty/error messages and
Refresh offers remain available. There is no imitation phone status bar.

The front page now has TVL after Duration, with identical cell typography.
Preview rows show $500,000, $700,000 and $900,000 for the 3-, 5- and 7-day
samples. These are display placeholders, not private budget amounts or live
TVL readings. The API build shows unavailable TVL until real data is connected.
The third sample is added without resetting existing requests or campaign edits.

Enabled incentive-modal buttons brighten by 15% on mouse hover, replacing the
shared 60%-opacity dim. Disabled controls and navigation styles are unchanged.


- C06 shows four creation stages, elapsed time and verified progress. An API
  failure keeps the last known state and disables dependent position actions.
- Live mode retains canonical payment recovery across reloads and tabs. Each
  paid request is independent; one wallet can request multiple vaults.
- Portfolio uses the API's current ownership and position state. It shows vault
  start and maturity dates, premium claims and mature LP withdrawals.
- Public cards and modals have no capacity meters, amount caps or user quotas.
  Admin Portfolio alone shows a near/over-target advisory. The planning target
  can change without repricing an existing campaign or blocking new requests.
- C05, refund-request/retirement controls, gas-spending records and treasury
  balance tracking are absent. Refunds remain a manual operator process.

The approved sidebar, fonts, header hover, NEW placement, Claim $X modal, Back,
LP-details disclosure and exact truncating token labels remain. Live APR keeps
its pool picker, comparisons, observation lifecycle, histories and PNG export.
Campaign APR is not substituted for measured pool APR.

## Install

Use Node 22.9 or newer, npm, and HTTP(S). The source archive needs no other repo
for preview builds. A compatible APR v2 gateway is needed for actual APR data.

```sh
npm ci
npm run dev
```

The preview state key remains `saffron.live-apr-merge.campaign-preview.v1`.
Existing requests and campaign edits survive the update. Reset preview affects
only this key. C06 for saved samples is labelled as sample progress, not chain
evidence. Live mode instead uses API/database state and local payment-recovery
records; preview reset is not available there.

For the published nested mount, put these public settings in `.env.local`:

```dotenv
VITE_BASE_PATH=/saffron/apps/feature-lab/live-apr-merge/
VITE_LIVE_APR_API_BASE=/saffron/api/live-apr/v2
VITE_FEATURE_LAB_HREF=/saffron/apps/feature-lab/
```

Then run `npm run build:lab`. These steps also apply on Windows. Use
`VITE_BASE_PATH=/` for a root install. A runtime
`window.__SAFFRON_LIVE_APR__ = { apiBase: '/your/api/live-apr/v2' }` before the
entry script can override the APR endpoint. Never put secrets in frontend settings.
Serve extensionless routes with SPA fallback; missing assets must return 404.
See [deployment and rollback](docs/DEPLOYMENT.md).

## API-connected mode

Run `npm run build:live`. Serve `dist-live/` through the canonical
`saffron-scaffold/liquidity-incentives` backend, at the same base path.
Set that server's `DIST_DIR` to this output. The server must own
`<base>/api/incentives`, `<base>/rpc/robinhood` and its price routes.
Use its README and runbooks for PostgreSQL, protocol configuration, keyless
watcher, reviewed creation and external premium funding. This archive does not
include backend services, signer configuration or credentials.

The live hook enforces the exact stored ETH fee and current API quote deadline.
The preview has no deadline; this is not a promise of unlimited quote validity
on the backend. Back permits a fresh unpaid review; submitted payments retain
recovery. See [creation and deposit confirmation](docs/CLAIM-FLOW.md).

## Routes

- `/`: Home and incentive offers.
- `/portfolio/vaults`: saved requests and current positions.
- `/campaigns`: operator campaign calculator and planning targets.
- `/admin`: operator controls.
- `/live-apr`: NVDA / USDG 0.05% default.
- `/live-apr/:poolId?compare=...`: pool with up to three comparisons.
- `/stats`, `/community`: scaffold sections, not invented live statistics.
- `/?view=campaigns`: legacy redirect with query/fragment preserved.

Sidebar: Home, Portfolio, Saffron pro, Live APR, Stats, Audits, Community.
Saffron pro and Audits are external links. The shared shell is dark-only.
Inactive Live APR text shares the APR paint; selected text is white. Lazy APR
observations release on exit and get fresh baselines on return. Clipboard PNG
requires HTTPS or localhost. Tweak → NEW on left remains a saved lab preference.

## Verify

```sh
npm test
npm run check:upstream
npx playwright install chromium
npm run build
```

For the root preview build, set `MERGE_BASE=/`, then run `npm run test:browser`.
For a nested lab build, omit that override. `MERGE_WEBROOT` selects a different
build directory; `MERGE_EVIDENCE` selects the output directory. The preview
browser harness uses checked-in APR wire fixtures and actual PNG pixels. It
checks responsive UI, capacity removal, multiple requests, private advisories,
saved C06 progress and reset isolation without a real wallet or API.

For the API integration test, first build live mode at base `/`. Install the
canonical backend's test dependencies and provide its disposable PostgreSQL
fixture settings as documented there. Set `SAFFRON_BACKEND_SOURCE` to its
`liquidity-incentives` package, then run `npm run test:backend-browser`.
The test starts generated wallets and a local EVM. It tests an exact fork
simulation before creation, then payment recovery, C06, premium funding, LP
entry, claim, start/maturity and withdrawal. It does not use the VNC browser,
production keys or mainnet funds. This release's checks ran on Linux; do not
infer a new Windows end-to-end run from the portable build instructions.

## Source and maintenance

- `src/merge`: shared router, section boundaries and explicit live wallet entry.
- `src/host`: approved shell plus canonical payment/polling/API hooks.
- `src/incentives`: merged product UI.
- `src/preview/runtime.ts`: isolated in-browser DTO adapter; no network fallback.
- `src/adapters`: canonical chain and wallet adapters, live build only.
- `src/livePoolApr`: pinned APR feature and contract tests.
- `shared`, `vendor`: pure helpers and pinned UI primitives.

[Product integration map](docs/PRODUCT-SYNC.md) accounts for all 26 commits since
the old incentives baseline. [Upstream manifest](docs/upstream-sync.json) pins
unchanged imported files. `check:upstream` verifies them locally; passing a new
backend package path also detects upstream drift. Adapted UI files need manual
review, not blind copying. `source-provenance.json` preserves original import
hashes and records this update. Source ZIPs include final file hashes.

Before reporting future watcher work as deployed, review this separate frontend
and both build modes. A backend/VNC deployment does not update this page.

## Combined repository

This standalone frontend is also tracked at
`feature-lab/live-apr-merge/` in `saffron-finance/saffron-scaffold`, on the watcher
feature branch. Backend and frontend can therefore be pulled together. The
existing Feature Lab source checkout is retained as a synchronized deployment
workspace, not as evidence of an automatic deployment. Build and publish explicitly.
