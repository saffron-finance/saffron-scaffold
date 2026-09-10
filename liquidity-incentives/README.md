# Saffron Scaffold — liquidity incentives

An independent application for user-authorized Saffron LP vault deployment on
Robinhood Chain (4663). Users select a program and exact USD size, authorize
creation without a request fee, and enter the fixed side after an operator funds
the premium. Deposit, claim, maturity and withdrawal stay in this interface.
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
2. Select a program and USD size, then authorize deployment. The worker creates
   the adapter and vault and initializes it automatically.
3. In **My vaults → Administration**, approve the vault's premium funding.
4. Return to **My vaults → Deposit**. Wrap ETH if needed, approve LP assets,
   deposit and claim using the shared modal.
5. Type `mature` in the demo terminal to advance the disposable chain. Renew the
   session when prompted and withdraw the matured position.
6. Type `quit` or close Chromium to stop and remove the fixture database.

`npm run demo -- --smoke` checks the same stack headlessly and exits. Demo keys
exist only in memory. Production entry points never load demo seeds/configuration.

### Configured application development

Copy `.env.example` to the ignored `.env`. Configure PostgreSQL, server-side
Robinhood RPC, the explicit USD provider, public protocol config, operator wallets
and the exact browser origin. New production databases start with an empty catalog
and no campaign allocation. Configure pairs, budgets and programs at `/admin`.
See [the operator runbook](ops/README.md) for service and worker provisioning.

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

- An origin-bound wallet session and separate EIP-712 signature authorize one
  exact quote. Acceptance atomically saves intent, reservation, ledger and job.
  Replaying the authorization returns the same intent.
- The existing scaffold worker EOA creates vaults, pays creation gas and supplies
  separately approved premiums. The HTTP process has no key and cannot broadcast.
- Programs share campaign budgets in raw reward-token units. Available premium is
  `limit − reserved − allocated`. Funding moves reserved to allocated; claims and
  maturity never replenish cumulative spending.
- Only verified unused-funding recovery/retirement releases a commitment. Timeouts
  never release unresolved signed transactions.
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

The clean `saffron_incentives` schema contains `pairs`, `budget_pools`, `programs`,
`deployment_quotes`, `deployment_intents`, `budget_reservations`, `budget_entries`,
`vault_jobs`, `chain_operations`, `vault_observations`, `worker_heartbeats`, and
`user_operations`. There are no paid-request, receipt-import/export or compatibility
tables in the application.

## Validation and release

With the disposable PostgreSQL connection configured:

```sh
npm run build
npm test
npm run test:database
npm run test:lifecycle
npm run test:browser
npm run demo -- --smoke
```

For lab controls, run `npm run build:lab`, set `SAFFRON_TEST_LAB=1` in the test
process environment, and run:

```sh
npm run test:browser -- --grep 'approved cards'
```

Unset `SAFFRON_TEST_LAB` before the normal suite and run `npm run build` to restore
the production build.

Tests cover real SQL concurrency/rollback, signature replay, cumulative budgets,
creation-stage recovery, cancellation, reorganization accounting, funding gates,
real Uniswap mint/claim/withdrawal, early LP recovery and transferred ownership.
Browser tests use the actual Node server/database/chain and cover lost responses,
operator editing, mobile layout, keyboard focus and wallet layering. Protocol test
sources and UI primitives are explicitly packaged in `tests/protocol` and
`vendor/fixed-income-ui`. These sources are maintained in this package.

The independent CI workflow runs database/EVM/browser checks and portable-build
checks. Publishing/worker activation remain separate operator actions.
[IMPLEMENTATION.md](IMPLEMENTATION.md) records the modular stages and validation.
Local tests do not establish a live deployment or live funding.
