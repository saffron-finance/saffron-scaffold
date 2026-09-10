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
### Stage 3: worker execution and application API

Accepted user intents now dispatch automatically through the scaffold worker. Creation keeps its durable transaction journal and canonical checks; admin funding, retirement and variable fee collection are separate operations. Retry scheduling avoids repeatedly claiming a blocked job. Signed transactions are checked against the accepted quote and campaign pause inside the persistence transaction before broadcast.

The clean API provides wallet sessions, quotes, deployments, catalog/budget administration and operator recovery. The HTTP process performs reads only; pricing is an explicitly configured provider. Operator reconciliation accepts only a confirmed semantic replacement or same-nonce zero-value self cancellation. A reorganization of a released commitment freezes admission and requires restoring the obligation before the worker repeats retirement.

Validation: 10 intent/auth/database checks; one real HTTP authorization/privacy test; three local EVM scenarios covering create/fund/deposit/claim, lost receipts/restart/fair scheduling, and retirement plus an actual local-chain rollback. The EVM scenarios use real pinned Saffron contracts with a position-manager double; real Uniswap lifecycle coverage follows with the UI stage. The public UI still needs conversion to the new API in the next commit.

### Stage 4: unified interface and native position lifecycle

- Replaced paid requests with exact deployment review and a shared page-two lifecycle panel, also opened by My vaults. Removed fee, receipt-file, compatibility-schema, legacy API, and obsolete browser/test code.
- Added wallet-session renewal, durable authorization replay and wallet-action recovery, exact approvals, optional ETH wrapping, fixed entry, premium claim, maturity withdrawal and pre-start recovery. Completion requires verified withdrawal evidence rather than a zero balance.
- Added operator budget/program maintenance and separate funding, retirement, fee collection, and transaction reconciliation controls. No admin creation form or public variable-side entry remains.
- The normal build passes. Twelve unit/relay checks and nine database/API checks pass. Three existing new-flow EVM scenarios pass; an additional real Uniswap position-manager test completes mint, claim conversion, withdrawal and fee collection.
- Six browser scenarios have passed against the actual production server and disposable PostgreSQL/Anvil: the full lifecycle, mobile/keyboard layout, two wallet-layer cases, interrupted authorization/wallet-response recovery, and exact operator budget/program editing. The maturity test also exercises session expiry and renewal.

### Stage 5: recovery verification and independent operation

- Added interruptions before broadcast at each of the three creation stages,
  canonical same-nonce cancellation/resume, and immutable-plan tampering checks.
  Added real Uniswap pre-start LP recovery and transferred claim-token ownership.
- Added worker gas/backlog status, removed the background observer's 500-vault
  cutoff, and limited API transaction queries to public metadata. The worker
  no longer requires a price provider after acceptance.
- Removed unused multi-chain/private browser RPC configuration. The production
  relay sanitizes provider diagnostics, bounds batches and fails closed during
  RPC outages. Idle database disconnects reconnect without losing accepted intents.
- Added a disposable, generated-wallet demo using the actual server, real SQL,
  Saffron contracts and real Uniswap manager. Its external price/wallet boundaries
  are local fixtures. Startup failures and normal shutdown clean up owned resources.
- Replaced obsolete setup/operations documentation and examples with the independent
  application runbook. Added package-specific CI without publishing.

Validation:

| Check | Result |
| --- | --- |
| Install/build | Dependency installation, normal build and lab build pass |
| Unit/relay/runtime | 13 pass |
| PostgreSQL/API | 10 pass, including a real idle-connection termination/reconnect |
| Local EVM | 7 pass, including real Uniswap mint/claim/withdrawal and early recovery |
| Actual-server browser suite | 6 pass: lifecycle, lost responses, operator edits, layout and wallet layering |
| Lab browser control | 1 pass; changing Table font changes the actual offers |
| Disposable demo | Headless startup smoke passes against real API/SQL/local protocol |
| Root scaffold | Normal and mock builds pass |

Vite reports existing large application/3D-emblem chunks. The added CI definition
has not been run on GitHub.

Production activation remains operator setup: configure the RPC/USD provider,
database and exact origin; verify protocol hashes; provision a protected signer,
gas and reward assets; and allocate campaign budgets. Production activation is a
separate operator release step. The implemented user and operator flows are covered
by the checks above.
