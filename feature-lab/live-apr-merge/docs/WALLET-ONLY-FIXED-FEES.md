# Wallet-only requests and fixed ETH fees — 0.4.0

## Behavior

- Every frontend build uses actual wallet discovery and the canonical API.
- Connect is available on Home, Portfolio, operator pages and Live APR.
- Browsing public information is read-only and needs no wallet approval.
- Preparing requests verifies the connected wallet and chain. Payments and LP
  wrap, approve, deposit, claim, recovery and withdrawal use wallet transactions.
- Operator configuration requires a wallet-signed authenticated session.
- No browser-only simulation runtime, seeded catalog or fake account remains.
- Local-chain/VNC fixtures run the same application with generated test wallets.
  Test setup is confined to the test harness, not compiled into the frontend.
- Each campaign/program has its own required positive `requestFeeWei`. Operators
  enter ETH with up to 18 decimal places. The form never rounds or guesses a fee.
- New quotes copy the configured wei amount. No ETH/USD fee oracle or dollar peg
  remains. LP principal, premium economics and TVL can still use USD valuations.
- Fee changes affect new quotes only. Previously issued quotes, payments,
  recovery and full refunds keep their original amount and recipient.
- Existing campaigns without a fee remain visible but cannot accept new requests
  until the operator supplies one. Production catalogs are not filled with samples.

## Deployment

Normal and lab builds write `dist`; `build:live` remains a compatible alias with
`dist-live` output. All markers require `canonical-api` and `wallet:true`.
The API must serve the frontend at a matching BASE_PATH; static-only publication
cannot provide transactions. Configure a public WalletConnect/Reown project ID
for QR/mobile pairing. Without it the UI explicitly marks WalletConnect
unavailable and supports actual injected wallets and wallet browsers.

The backend also needs its ETH recipient, real configured campaigns, protected
RPC/protocol settings and operational intake/watcher/creator settings. These are
operator deployment configuration, never sample code or guessed live recipients.
No live funds are spent by the release tests.

## Validation

Node tests cover exact wei parsing, missing/invalid fees, per-campaign readiness,
fee changes during quote creation, immutable payments after fee changes, and
actual local-chain payments with changed token prices. Existing database,
refund, recovery and lifecycle checks remain applicable.

The combined UI tests use the real API, PostgreSQL and local contracts. They
exercise disconnected wallet gating, ignored old preview storage, campaign fee
creation/editing, responsive layout and fee disclosure. Mobile/desktop lifecycle
checks cover two payments, callback loss, watcher recovery, creation, external
funding, wrapping/approvals, LP entry, claim and withdrawal. The WalletConnect
fixture qualifies AppKit integration without claiming real-phone/relay evidence.
