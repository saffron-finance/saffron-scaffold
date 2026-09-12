# Wallet and native ETH payment cutover

## Separate three environments

- A default or lab build uses browser-only incentives. Its pool APR can still be
  live. Real APR does not make the vault requests real.
- A live build uses injected wallets, the canonical incentives API and PostgreSQL.
  Each immutable quote binds one $2-equivalent native ETH payment on chain 4663.
- The VNC harness owns a disposable database, chain, browser and generated wallets.
  Do not point it at live services, give it a real signer, or reset it for a release.

Live builds permit `VITE_UI_TWEAKS=true`. The visual controls do
not change wallet or payment behavior. `deployment-mode.json` records the compiled
adapter. A live build has no fallback to simulated requests when its API fails.

## Prepare before enabling payment

1. Back up the published assets, Git history and exact reverse-proxy configuration.
   Record the VNC service state. Preserve its database and browser storage.
2. Provision a separate production database and restricted API account. Never
   reuse a fixture database or upgrade an unrelated legacy payment schema.
3. Load only protected RPC configuration into the server. The API must never
   receive a creator key. Verify the live chain, factory code and type hashes.
   Its internal checkout reader needs `eth_getTransactionCount`; a relay that
   supports `eth_call` can still be insufficient. The browser relay remains
   read-only and rejects broadcasts and signing.
4. Confirm the chain-specific fee recipient and live campaign terms. Preview
   examples, placeholder TVL and suggested budgets are not live funding records.
   Create real catalog rows through the canonical operator workflow. New databases
   start empty and intake stays closed until configuration is complete.
5. Configure and supervise the keyless payment watcher with a reviewed start block.
   Retain its cursor and identity across restarts. Verify freshness and continuity.
6. Configure the automatic creator and its operating coverage before opening an
   expiring automatic intake window. Normal requests need no per-vault approval.
   Reviewed one-request execution is optional testing/recovery; its permission
   does not authorize the automatic queue. Premium funding remains external.

Follow the backend's `ops/README.md` and `ops/ONE-REQUEST.md` for these operations.
There are no request quotas, capacity hard limits, gas ledgers or treasury balance
checks. Unfulfillable accepted requests use operator-approved external refunds,
verified before permanent closure. Follow the backend's `ops/REFUNDS.md` and
`ops/FULFILLMENT.md` for policy and ownership.

## Build and route

Use `.env.local` for public frontend settings, including `VITE_BASE_PATH`, the
independent `VITE_LIVE_APR_API_BASE`, and optional `VITE_UI_TWEAKS=true`.
Run `npm run build:live`. Use the same mount for backend `BASE_PATH` and point
`DIST_DIR` at this build. Keep server secrets out of frontend variables and ZIPs.

The existing GET/HEAD-only static route cannot handle checkout. Stage a reverse
proxy to the canonical server for the app mount, including `/api/incentives`,
`/rpc/robinhood` and `/prices`. Preserve TLS authentication, cookie and Origin
headers, request size limits and real asset 404s. Use the hosting provider's
existing staging access; no additional password gate is required. Hosting
identity must not become application operator authority. Keep the unrelated
APR routes and VNC mount unchanged.

Retain old hashed assets for already-open tabs. Publish new assets before the
entry document. Validate the reverse-proxy configuration before reload, then
verify the actual served mode and file hashes. Do not describe staging as live.

## Verify without spending live funds

Run unit checks and both build modes. Run the preview browser suite to prove
simulation isolation. Run `test:backend-browser` against a random disposable
database and EVM. This test now starts on mobile Home, connects a generated wallet,
pays two independent test fees, loses a callback, reloads and recovers without
another fee or a message signature. It fork-simulates exact creation before
testing C06, partial funding, LP entry, claim, maturity and withdrawal.

Check the staged server:

```sh
node scripts/check_live.mjs http://127.0.0.1:3201/ --expect-closed
```

Use its actual loopback port and complete mount. When intake is intentionally
enabled, rerun without `--expect-closed`. A passing closed check means only that
the API is correctly isolated and refuses new payment quotes. It does not mean
payments are available. A disposable full-cycle test is not a mainnet payment.

## Rollback without losing requests

Close new intake first. Restore the previous route and static entry from backup,
validate the proxy, then reload it. Keep the database, watcher cursors, accepted
payments and execution permits. Do not drop the production database or clear
wallet recovery storage to roll back frontend code. Keep any permanent signing
permit; an older Git revision cannot undo a payment or on-chain transaction.

A new, still-empty service can be stopped without altering VNC or the old site.
Archive its configuration and database instead of treating Git rollback as an
operations rollback. Protected RPC runtime files must be regenerated from the
existing secret store, never copied into a source package.
