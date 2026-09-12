# Mobile wallet and payment release preparation

Frontend version: 0.2.4. **Staged, not published. Payment intake is closed.**

The previous public page is still a browser-only incentive preview. Its real
APR observations do not establish a live paid-request backend. This work keeps
the approved mobile Home and provides a verified cutover to the canonical API.

## Changes

- Allow the existing appearance controls in an explicit live build. They cannot
  switch its payment adapter to simulation.
- Emit `deployment-mode.json` so operators can verify the served adapter and
  mount before enabling payments.
- Start the canonical full-cycle browser check on mobile Home. Verify the real
  wallet boundary, two independent test fees and durable reload recovery.
- Add a no-spend live preflight and deployment/rollback instructions.
- Fix canonical static serving: missing assets and downloads return 404 instead
  of the SPA entry document. Add a dedicated regression test.

## Executed validation

Frontend: 47 unit tests, 29 source pins, live and lab builds, 17 preview-browser
groups with no unexpected network requests. The mobile canonical backend test
uses a disposable PostgreSQL database and EVM. It covers lost callbacks, watcher
admission, reload recovery without a duplicate fee or message signatures, exact
fork simulation, C06, partial funding, LP entry, claim, maturity and withdrawal.

The new loopback staging API passed the closed-intake preflight against live
Robinhood read RPC. Seven server boundary tests pass, including missing assets.
The proposed reverse-proxy configuration passes its validator. No wallet
transaction was submitted on mainnet. No signing worker was activated.

VNC browser, web and database process identities are unchanged. Its route and
the public preview route are unchanged. Backups include the prior public assets,
verified Git bundle and exact route configuration.

## Remaining configuration

The Robinhood fee recipient and actual campaign terms need to be supplied before
public cutover. The old Arbitrum fee service is not a compatible Robinhood API.
Preview examples were not imported as funded production campaigns. The separate
new database is empty, and the staged API cannot issue payment quotes.

See [the cutover runbook](live-apr-merge/docs/LIVE-CUTOVER.md) and
[machine-readable validation](live-apr-merge/docs/verification-wallet-staging-20260912.json).
