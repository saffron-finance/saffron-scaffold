# Saffron Scaffold — liquidity incentives

An independent application for campaign-budgeted Saffron LP vault deployment on
Robinhood Chain (4663). Users select a campaign and USD size, pay the campaign’s fixed fee in native ETH
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
2. Select a program and USD size, then pay the quoted the campaign’s fixed fee in test ETH. The worker creates
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
USD planning budget, fixed-side planning target, and APR; the third is calculated.
These targets never cap paid requests.
Supervise the keyless payment watcher, provision
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

## Mobile wallets

Set the public `VITE_WALLETCONNECT_PROJECT_ID` (32 hex characters) before building
this interface to enable WalletConnect alongside injected wallets. Configure its
allowed HTTPS origins in the Reown dashboard. The wallet must support Robinhood
Chain (4663). With the setting blank, wallet browsers/extensions remain available.

WalletConnect opens mobile wallet links or desktop QR pairing. No user message
login is added. Accepted sessions restore without prompting; returning from a
wallet refreshes account/chain state. Disconnect ends the session and retains
payment recovery records. A cancelled proposal never reconnects the application
when approved late; reject the old request in the wallet before trying again.
Qualify real wallet/phone combinations and relay connectivity before advertising
them. The merged public interface documents the detailed WalletConnect checks.

Wallet-specific gas estimates and pending nonce reads use the same-origin
read-only RPC route. Signing and transaction broadcasts remain in the wallet;
the relay continues to reject those methods, including in mixed batches.

## Domain and accounting

- Each canonical fixed campaign ETH payment authorizes one exact vault request.
  Users can create any number of separately paid requests. Unpaid quotes reserve
  no capacity. There are no per-wallet, browser, queue, or campaign-size quotas.
- Campaign budget and fixed-side target determine the premium rate. They are
  advisory planning inputs, not admission limits. Paid commitments can exceed
  either target. Amounts must still fit the contract and positive integer math.
- The operator can edit a separate planning budget without changing quoted rates.
  At 90% committed, an authenticated operator sees a near-capacity banner on
  My requests (the portfolio). It never appears on public offers or in modals.
  Public catalog/quote data contains the premium rate, not internal budget totals.
- The keyless watcher discovers payments without the browser callback. The C05
  tracker is removed. Payment review offers explicit recovery. Browser storage
  keeps independent per-wallet records, not a single-request allowance.
- C06 remains: adapter creation, vault creation, initialization, then premium
  funding. PostgreSQL and canonical chain observations hold shared state. Browser
  storage holds private recovery capabilities and transaction recovery details.
- The creator only creates and initializes vaults. External funders deposit the
  exact frozen premium and own variable-side rights. There is no treasury balance
  polling, inventory allocation, funding brief, or treasury admission check.
- Canonical vault funding still gates LP entry. Current bearer ownership controls
  claim, recovery, and withdrawal. Request identity does not confer token ownership.
- Unfulfillable accepted requests receive the full original ETH creation fee
  through an external operator payment. [Refund administration](ops/REFUNDS.md)
  prepares manifests and verifies payouts before permanently closing requests.
  Ordinary LP claim, recovery and withdrawal rights remain available.
- No daily gas/subsidy ledger or gas reservations remain. Per-signature gas bounds,
  signer nonce checks, durable signed bytes, canonical receipts, and one-request
  execution permits remain necessary for safe transaction recovery.
- Portfolio and admin lists use cursor pagination (25 by default, up to 100 per
  page). Pagination is not a request-count limit.

[IMPLEMENTATION.md](IMPLEMENTATION.md) defines storage and migration behavior.
Existing deprecated tables and historical records are preserved on upgrade, not
used by new flows. Back up the database and protected permits before upgrading.

## Maintained VNC test site

The complete hosted test harness and regression tests are in [ops/vnc](ops/vnc/README.md).
The runbook covers installation, configuration, backup, reset, browser recovery,
and upgrades. Linux/systemd hosts VNC; Windows users can access the hosted viewer
or use the portable local demo. Refresh reads the current test; Start fresh test
archives it and starts a new disposable environment.

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
npm run test:vnc
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

Tests cover real SQL concurrency/rollback, payment replay, advisory targets, unlimited paid requests,
creation-stage recovery, reorganization accounting, funding gates,
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

## One wallet/API application

All normal and lab builds use the canonical API and an actual connected wallet.
There is no browser-only preview, seeded production catalog or fake transaction
transport. Appearance controls change styling only. Read-only browsing does not
require a connection; requests, payments, LP actions and operator authentication
use the wallet at their normal authorization boundaries.

Local-chain/VNC tests run the same code against disposable contracts with a
funded generated wallet. Mainnet uses a real wallet on Robinhood Chain (4663).
Never substitute test fixtures or browser storage for payment evidence.

Each program requires `requestFeeWei`: a positive, bounded integer string in
wei. Campaigns UI accepts exact ETH decimals (at most 18 places); it has no
implicit fee default. Existing campaigns without the field cannot quote until
an operator sets it. Fee edits affect new quotes only. Existing paid requests,
recovery records and full refunds retain their original quoted wei amounts.
No ETH/USD request-fee lookup remains. USD inputs for LP sizing, APR economics
and TVL are separate and unchanged.

## Verified operator deployment

[Vault #2 live test, 11 September 2026](ops/live-tests/2026-09-11-vault-2/README.md): exact pre-signing factory fork, three successful live receipts, canonical state verification and recovery regressions. Creation/initialization succeeded; premium funding and LP entry were not performed. The normal payment watcher remains a separate path.

## Operator token discovery and campaign IDs

The campaign form no longer accepts an ID or a custom name. The API assigns
`campaign-<UUID>` and derives the heading from the selected pool's token symbols.
The UI sends a hidden `creationKey`; retries with the same operator and terms
return the existing campaign. Changed terms or another operator conflict.
Legacy explicit IDs remain accepted for existing integrations. No schema or
existing campaign/quote migration is needed.

Add pair uses the fixed-income Create Vault interaction: two searchable token
modals, swap and fee tiers. The first token is the reward asset. The authenticated
read-only endpoints are `GET /admin/tokens`, `GET /admin/tokens/:address`, and
`GET /admin/pools?token0=<address>&token1=<address>`, beneath `/api/incentives`.
The public CoinGecko Robinhood token list needs no API key; it is bounded and
cached for one hour. On failure, canonical WETH/USDG/SFI discovery remains, with
a one-minute retry. Tokens can also be entered by contract address. Lists are
discovery hints, not campaign catalogs or authoritative token metadata.

The API reads ERC-20 metadata and discovers pools through the Uniswap factory
returned by Saffron's position manager. All reads use one block on chain 4663,
so the same behavior works on a wallet-connected local fork. The save endpoint
independently checks token addresses, decimals and pool fee. No transaction,
price oracle, new signer, or operator credential is added by this feature.

The token list fallback and selector interaction are adapted from
`saffron-finance/fixed-income`: `web3/assets/files/robinhood-tokens.json`,
`TokenStepFields.tsx`, `SelectTokenModal.tsx`, and `SelectTokenButton.tsx`.
