# Frontend 0.8.0 compatibility and publication boundary

This release publishes browser code, assets, wallet actions, browser/unit tests,
and portable frontend packaging only. It does not publish server/operator/worker
changes, host scripts, signer setup, credentials, database state or live logs.
The previously published backend in `liquidity-incentives` remains unchanged.

## Interface requirements

Use the same-origin incentives API and read-only RPC relay described in the
existing transport contract. A static frontend cannot run these services.

- Deployment context must provide a fresh vault snapshot and requesting wallet
  balances. The browser reuses this context instead of duplicating vault reads.
- Admin funding needs authenticated `GET /admin/deployments/:id/funding-context`
  returning the deployment, trusted-vault snapshot and authenticated funder.
- Admin withdrawal needs `GET /admin/deployments/:id/withdrawal-context`, current
  paused/closed program control and that wallet's withdrawal eligibility. An old
  backend without these routes cannot provide these two new admin actions.
- Status may include separately managed server readiness and repair guidance.
  `VITE_OPERATOR_CONSOLE_HREF` selects the separate console; by default it is a
  sibling `server-operator/` route. The console implementation is not included.
- Wallet sends remain explicit. Payment identity, chain, quote binding and
  recovery checks remain; USD principal/incentive equality with an earlier
  preview is no longer a reason to reject or rewind a payment.

## Browser read budget

Price previews refresh every two minutes while visible, share requests/results
within a tab, and cool down failures for ten seconds. Pool token orientation is
cached for thirty minutes. First load uses four RPC reads plus one price API
request; subsequent refreshes use two RPC reads plus one price request. Reopen,
focus and manual refresh reuse fresh results. Quote preparation suspends preview
polling. Catalog polling is visible-only at thirty seconds; explicit edits can
refresh it immediately. Server-side caching policy is managed separately.

## Verification and history

Run `npm ci`, `npm test`, `npm run test:source`, `npm run test:release`,
`npm run check:upstream` and `npm run build`. Browser/lifecycle suites additionally
need a compatible disposable backend, never a production wallet or database.
`docs/upstream-sync.json` retains exact pins for unchanged shared/wallet files;
intentionally evolved frontend files are recorded as adaptations, not represented
as byte-identical copies of the historical backend UI.
