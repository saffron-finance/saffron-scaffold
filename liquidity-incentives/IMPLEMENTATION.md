# Independent incentives application: implementation record

This document records the application scope, implementation stages and validation.
See [README.md](README.md) for setup and [ops/README.md](ops/README.md) for operation.

Scope: one new user-authorized deployment flow; no paid requests, historical
compatibility or receipt import/export. The application owns its UI, API and database.
The existing scaffold worker remains the executor on Robinhood Chain.

## Implementation choices

- Keep the existing worker EOA as creator, gas payer, and initially premium funder.
  Premium funding remains a separate operator authorization.
- Programs draw from explicit campaign budgets in raw reward-token units. Spent
  premiums never become available again merely because a user claims or matures.
- Production budgets start empty until an operator configures an allocation.
  Seeded, funded budgets belong only to disposable test fixtures.
- User authorization is bound to one immutable quote and cannot create a second
  commitment when a response is lost. Canonical transaction evidence governs recovery.
- Preserve the approved interface. The front-page modal and profile share entry,
  claim, and withdrawal actions; ordinary users only participate on the fixed side.

## Commit stages

1. Portable development baseline: install/build, Anvil, price proxy, preview selectors.
2. Clean domain, wallet authorization, schema, and atomic cumulative budget accounting.
3. Worker execution, native API, funding, reconciliation, and retirement.
4. Unified user and operator interfaces; remove paid-request and compatibility code.
5. Claim, withdrawal, real-protocol lifecycle verification, and operational delivery.

Each stage records its checks below. Production signing/funding activation is an
operator deployment step; automated checks use generated wallets and disposable databases.

## Validation record

### Stage 1: portable baseline

- `npm ci` and `npm run build:lab` pass without shell-specific configuration.
- 81 existing API/unit checks pass; the added actual-Vite address-price regression passes.
- All 3 existing native EVM tests pass using the packaged executable.
- The focused browser layout/mobile flow passes with the approved card styling.
- Anvil is pinned through platform-specific optional packages, avoiding the wrapper's
  shell-specific postinstall. Test setup must retain optional dependencies.

### Stage 2: clean domain and budget core

- Added the application-owned `saffron_incentives` schema, with no old tables required.
- Wallet sessions are origin-bound, HttpOnly, expiring, and protected by CSRF; a
  separate EIP-712 authorization binds the exact deployment quote and unique identity.
- Concurrent acceptance reserves budget and persists the intent/job atomically.
- Funding moves reserved premiums to allocated spending. Claim/maturity leave spending
  allocated; pre-start withdrawal retains the obligation as a reservation.
- Ten focused checks pass, including real PostgreSQL concurrency, transaction rollback,
  duplicate response recovery, quote/revision expiry, queue limits, cancellation, and ledger drift.
# Stage 3 — worker execution and application API

Accepted user intents now dispatch automatically through the scaffold worker. Creation keeps its durable transaction journal and canonical checks; admin funding, retirement and variable fee collection are separate operations. Retry scheduling avoids repeatedly claiming a blocked job. Signed transactions are checked against the accepted quote and campaign pause inside the persistence transaction before broadcast.

The clean API provides wallet sessions, quotes, deployments, catalog/budget administration and operator recovery. The HTTP process performs reads only; pricing is an explicitly configured provider. Operator reconciliation accepts only a confirmed semantic replacement or same-nonce zero-value self cancellation. A reorganization of a released commitment freezes admission and requires restoring the obligation before the worker repeats retirement.

Validation: 10 intent/auth/database checks; one real HTTP authorization/privacy test; three local EVM scenarios covering create/fund/deposit/claim, lost receipts/restart/fair scheduling, and retirement plus an actual local-chain rollback. The EVM scenarios use real pinned Saffron contracts with a position-manager double; real Uniswap lifecycle coverage follows with the UI stage. The public UI still needs conversion to the new API in the next commit.
