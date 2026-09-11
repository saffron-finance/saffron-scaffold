# Saffron Scaffold — liquidity incentives

An independent application for campaign-budgeted Saffron LP vault deployment on
Robinhood Chain (4663). Users select a campaign and USD size, pay $2 in native ETH
for creation, and enter the fixed side after external operations funds the premium.
There is no user sign-in message, EIP-712 authorization, or USDC payment option. Deposit, claim, maturity and withdrawal stay in this interface.
The package owns its UI, API, sessions and database. The root scaffold application
and its static Pages build remain separate.

## Local setup

Use Node 22.9+, npm, PostgreSQL 16+, and Chromium for the browser tests/demo. Keep
npm optional dependencies: they provide pinned native Anvil binaries without
shell-specific installation steps.

From this directory:

```sh
npm ci
npx playwright install chromium
npm run build
```

### Disposable full-flow demo

Use a local PostgreSQL test role with CREATEDB. The harness creates a random
`saffron_incentives_test_<hex>` database and drops only that database on shutdown.
It never seeds or resets the application database. Set these environment variables
for the test connection, then run the demo:

| Variable | Value |
| --- | --- |
| `SAFFRON_TEST_DB_HOST` | Test database hostname |
| `SAFFRON_TEST_DB_PORT` | Test database port |
| `SAFFRON_TEST_DB_USER` | Test role with CREATEDB |
| `SAFFRON_TEST_DB_PASSWORD` | Test role password |

```sh
npm run demo
```

The demo opens dedicated Chromium with the actual production server, PostgreSQL,
pinned Saffron contracts, real Uniswap V3 factory/position manager, test tokens,
and a generated local wallet. Only the external USD provider and injected-wallet
boundary are substituted. No live wallet or RPC is used.

1. Connect **Uniswap Extension** in the demo. This generated wallet is also the
   demo operator; the worker uses a separate generated EOA.
2. Select a program and USD size, then pay the quoted $2 in test ETH. The worker creates
   the adapter and vault and initializes it automatically.
3. Type `fund` in the demo terminal to simulate external treasury variable-side
   deposits. This test-only helper is not part of the production creator.
4. Return to **My requests → Deposit LP assets**. Wrap ETH if needed, approve LP assets,
   deposit and claim using the shared modal.
5. Type `mature` in the demo terminal to advance the disposable chain, then
   withdraw the matured position. No message sign-in is required.
6. Type `quit` or close Chromium to stop and remove the fixture database.

`npm run demo -- --smoke` checks the same stack headlessly and exits. Demo keys
exist only in memory. Production entry points never load demo seeds/configuration.

### Configured application development

Copy `.env.example` to the ignored `.env`. Configure PostgreSQL, server-side
Robinhood RPC, the explicit USD provider, public protocol config, operator wallets,
the public `SAFFRON_CREATION_FEE_RECIPIENT`, and the exact browser origin. New production databases start with an empty catalog
and no campaign allocation. Configure pairs and create campaigns at `/admin`. Enter duration and any two of
USD budget, fixed-side target capacity, and APR; the third is calculated.
Assign treasury inventory, supervise the keyless payment watcher, provision
creator gas and configure an expiring intake window before offering payment.
Reviewed one-request mode works without a continuously running signer. Automatic
queue mode also requires the signing worker heartbeat. See [the operator runbook](ops/README.md).

For hot reload set `SAFFRON_APP_ORIGIN=http://127.0.0.1:5187`, run these in separate
terminals, and open that exact origin:

```sh
npm run serve
```

```sh
npm run dev
```

Vite forwards `/api/incentives`, `/rpc/robinhood` and address-based `/prices/` to
port 3201. `DEV_API_ORIGIN` can override the API target. For the built app directly
on port 3201, change `SAFFRON_APP_ORIGIN` and restart the server. `localhost` and
`127.0.0.1` are different session origins; use one consistently.

`npm run build:lab` includes optional Tweak controls/fonts. `npm run build` excludes
them. `SAFFRON_API_DISABLED=1` allows a shell/relay inspection without a database;
it does not seed programs or accept deployments.

The sidebar collapses to a full-height 64px icon rail that reserves its space.
Clicking the rail or pressing Enter/Space reopens navigation without remounting
the logo or page. Hover shifts only its painted surface; reduced motion disables
the shift. Offer cards retain their gray surface with a gold hover border.

Opening the vault modal or returning to its amount step focuses the deposit field.
Typing and price updates preserve focus. Continuing focuses the review heading,
and closing returns focus to the control that opened the modal.

## Domain and accounting

- The exact native ETH payment binds payer, quote, chain, recipient and plan. A
  canonical confirmed payment atomically admits one intent, reservation and job.
  Replaying it returns the same intent. Public receipt hashes alone cannot restore
  a browser session; the browser retains a private payment-bound recovery record.
- The worker EOA only creates/initializes and retires vaults. It pays creation gas;
  the API cannot sign or broadcast. External operations owns premium funds and
  calls the vault's variable-side deposit itself.
- Campaign creation fixes duration and any two of USD budget, target fixed-side
  capacity and simple APR. $10,000 / $1,000,000 / 3 days gives **121.6667% APR**.
- Quotes temporarily hold capacity; paid requests reserve it; confirmed external
  variable deposits move the corresponding budget and capacity to funded.
  Reservations also reduce availability, preventing concurrent over-creation.
- $5,000 of premium funding for a $500,000 request consumes half that example's
  budget/capacity. Actual LP entry is reported separately, never inferred from
  premium funding. Claim and maturity do not replenish cumulative allocation.
- Paid commitments do not automatically expire. Only verified unused-vault
  retirement releases them. An external funder must recover unused funds itself.
- Unpaid checkout is bounded per request, browser and campaign. Firm quotes reserve
  campaign, raw premium, queue and creation gas before payment. Larger amounts can
  receive an operator amount review without paying. The quote lasts 120 seconds;
  only canonical watcher settlement releases an unpaid hold after its deadline.
- The modal retains payment recovery and shows adapter, vault, initialization and
  external funding progress. Elapsed time is separate from the declared operator
  service window. Close/reload returns to the same request without another fee.
- Received duplicate, late or blocked fees have an audited resolution queue.
  Operators can admit the original immutable request when resources allow, or
  verify an externally executed refund. Neither action sends money from the API.

See **[CAMPAIGNS.md](CAMPAIGNS.md)** for formulas, rounding, USD valuation, lifecycle
accounting, payment recovery and the external-operations contract.

- **Depositable** requires fresh canonical evidence, exact full variable bearer
  supply, enough premium-token balance and no fixed occupant. A token transfer
  without bearer supply cannot enable entry.
- The front-page modal and profile share fixed entry and lifecycle actions. Current
  claim/bearer ownership controls actions. Completed requires verified withdrawal,
  rather than merely a zero balance.
- Confirmed claim and fixed-bearer transfers discover received positions in the
  holder's profile. Discovery follows bounded block ranges and checks reorganizations;
  fresh canonical balances authorize actions. Deployment cancellation stays with
  the original requester. Confirmed user actions preserve position history.
- Profile and administration lists have 25 entries per page with newer/older
  navigation. Refresh retains the current page. API clients may request 1–100
  entries with `limit` and continue using the returned `nextCursor` as `cursor`.
  Ordering retains timestamp precision and an ID tie-breaker as new entries arrive.

The clean `saffron_incentives` bootstrap includes campaign, checkout/admission,
treasury, payment/refund, gas, execution and canonical observation tables.
[IMPLEMENTATION.md](IMPLEMENTATION.md) defines their roles and state contracts.
No production seed or data migration is run. Current payment recovery, signed
journals and accounting evidence are durable application state and must be backed up.

## Validation and release

With the disposable PostgreSQL connection configured:

```sh
npm run build
npm test
npm run test:database
npm run test:lifecycle
npm run test:watcher
npm run test:restore
npm run test:browser
npm run demo -- --smoke
```

The restore test needs PostgreSQL 16 `pg_dump`/`pg_restore` in PATH, or
`SAFFRON_TEST_PG_CONTAINER` naming the disposable PostgreSQL container so the test
can invoke its matching tools. It creates a second random test database and
verifies that restoring an older queue cannot repeat later creator activity.

For lab controls, run `npm run build:lab`, set `SAFFRON_TEST_LAB=1` in the test
process environment, and run:

```sh
npm run test:browser -- --grep 'approved cards'
```

Unset `SAFFRON_TEST_LAB` before the normal suite and run `npm run build` to restore
the production build.

Tests cover real SQL concurrency/rollback, payment replay, campaign math/capacity holds, cumulative budgets,
creation-stage recovery, cancellation, reorganization accounting, funding gates,
real Uniswap mint/claim/withdrawal, early LP recovery and transferred ownership.
Browser tests use the actual Node server/database/chain and cover lost responses,
operator editing, mobile layout, keyboard focus and wallet layering. Protocol test
sources and UI primitives are explicitly packaged in `tests/protocol` and
`vendor/fixed-income-ui`. These sources are maintained in this package.

The independent CI workflow runs database/EVM/browser checks and portable-build
checks. Publishing/worker activation remain separate operator actions.
[IMPLEMENTATION.md](IMPLEMENTATION.md) defines the runtime contract and validation
map. The joined browser test writes public transaction and final ledger evidence
to ignored `validation/complete-cycle.json`. Disposable tests do not establish a
live full-cycle acceptance; live activation and treasury execution are separate.

The [complete-cycle acceptance record](ops/acceptance/2026-09-11-complete-cycle.md)
contains the executed checks, public transaction evidence and final ledger totals.

For keyless native-payment discovery and a strictly request-pinned, one-vault
operator test, use [the watcher and one-request runbook](ops/ONE-REQUEST.md).
This includes protected signer/RPC references and a real-factory Anvil fork.

## Browser-only UI review

`npm run build:preview` builds the actual campaign form and user modals with an
explicit preview-only transport in `dist-preview/`. Set `VITE_BASE_PATH` for the
host mount. The preview starts with the $10,000/$1,000,000, three-day example at
50% premium-funded. Vaults is the homepage; the hamburger menu links to My requests,
Campaigns (`campaigns/`) and Administration (`admin/`). Existing `?view=campaigns`
links still open the calculator. Campaign
edits and simulated requests stay in a separate browser-local storage namespace.

Every page reuses the approved `src/host/AppShell.tsx`: original sidebar, account
header, gray vault cards, fonts and spacing. Funnel Display, Host Grotesk and
Roboto Mono are bundled locally with SIL Open Font Licenses so preview routes
cannot lose their typography. Appearance controls remain review-build-only.

The footer and payment modal label sample data. It imports no wallet provider, sends no API/RPC
or price requests, and cannot make payments, deploy vaults or fund them. This is
not the production application or a substitute for backend integration. Normal
and lab builds exclude the preview entry/runtime. `node tests/preview-ui.mjs`
checks static-only interactions, math, local persistence and mobile layout; set
`PREVIEW_WEBROOT` to verify the published files through a loopback-only mirror.

## Verified operator deployment

[Vault #2 live test, 11 September 2026](ops/live-tests/2026-09-11-vault-2/README.md): exact pre-signing factory fork, three successful live receipts, canonical state verification and recovery regressions. Creation/initialization succeeded; premium funding and LP entry were not performed. The normal payment watcher remains a separate path.
