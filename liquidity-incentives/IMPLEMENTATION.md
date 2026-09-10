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
