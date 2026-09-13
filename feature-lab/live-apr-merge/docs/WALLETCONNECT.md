# WalletConnect

The incentive interface offers WalletConnect alongside EIP-6963 and legacy
injected wallets. Mobile browsers open the chosen wallet app; desktop users can
scan a QR code. The application retains its existing Robinhood fee, LP deposit,
claim, withdrawal and payment-recovery behavior. Connecting requires wallet
permission, without a user message-signing login.

## Configuration

1. Create/select an application project in the [Reown dashboard](https://dashboard.reown.com).
   Add each intended HTTPS application origin to its origin allowlist.
2. Set `VITE_WALLETCONNECT_PROJECT_ID` to that project's public 32-character hex
   ID in the frontend's ignored `.env.local`, then rebuild with `npm run build`,
   `npm run build:lab`, or `npm run build:live`.
   This public ID is embedded in browser assets; never substitute a secret key.
   Empty or malformed settings disable WalletConnect pairing and retain injected
   wallets; the connection dialog marks WalletConnect unavailable.
3. Match `VITE_BASE_PATH` to the backend's `BASE_PATH`. Pairing metadata uses the
   actual browser origin; session storage is scoped to the application mount.
   Keep the application available on the same origin when returning from a wallet.
4. Use a wallet with Robinhood Chain (4663), ETH and transaction-request support.
   The approved namespace must contain a Robinhood account and
   `eth_sendTransaction`. An incompatible approval is rejected before selection.
   Configure the optional public `VITE_WALLET_RPC_ROBINHOOD` if a wallet needs
   this chain added. Never expose a credential-bearing RPC endpoint through it.

The connector uses the [Ethereum provider](https://docs.reown.com/advanced/providers/ethereum)
and AppKit Core for QR codes, wallet selection and mobile links. The SDK loads
only on explicit WalletConnect selection or restoration of an accepted session.
All frontend build modes use actual wallets and the canonical API. Normal and
lab builds write `dist`; `build:live` writes `dist-live`. There is no simulated
preview mode. Wallet connection and every transaction still require the user's
wallet approval. Use the disposable test harness for simulated peers and local
contracts. Email/social sign-in, analytics, swaps and onramps are disabled.
Hosting must allow the SDK's Reown/WalletConnect directory, image and relay
traffic under its content security policy.

The SDK's Robinhood read fallback is the application's same-origin
`rpc/robinhood` route, including gas estimates and pending nonce reads. Signing
and transaction broadcasts use the wallet session. The HTTP relay rejects those
methods and rejects batches containing them. Fee recipients and amounts still
come from the immutable server quote; WalletConnect does not choose them.

## Returning, changing wallets and cancellation

- An accepted, unexpired session can restore after reload without opening a
  pairing sheet. Account/chain changes, focus, visibility and browser restoration
  refresh the application. They never automatically repeat a payment or deposit.
- Cancelling a connection ignores late approvals. A published proposal can
  remain pending in the SDK until the wallet rejects or expires it. Reject that
  request in the wallet before trying WalletConnect again; the application does
  not overlap proposals. An injected wallet can still be selected.
- Disconnect clears the selected wallet and accepted topic and requests session
  teardown. It keeps browser payment records for recovery. If teardown cannot
  reach the peer, the interface remains disconnected and advises ending the
  session in the wallet too.
- A peer disconnect, expired session or missing approved account makes the
  connection unavailable. Reconnect explicitly. Wallet account assertions and
  existing transaction-recovery controls still apply before every write.
- AppKit temporarily owns dialog focus while pairing. The original form returns
  when the sheet closes; it does not submit as a consequence of pairing.

## Verification and remaining qualification

`npm test` covers connection deduplication, rejection, cancellation during load,
late approval, approved-chain permissions, expiration, account changes, reload
restoration and disconnect. `npm run test:walletconnect` additionally builds an
isolated test application and runs the mobile lifecycle with the real AppKit UI,
canonical API, disposable PostgreSQL and real local protocol/Uniswap contracts.
Set `SAFFRON_BACKEND_SOURCE` and the database variables described in
[lifecycle acceptance](LIFECYCLE-ACCEPTANCE.md) first. The external directory and
WalletConnect peer are fixtures; no live relay, account, key or fee is used.
The fixture build has no release marker and cannot pass deployment preflight.

Before launch, qualify actual supported iOS/Android wallets and ordinary mobile
Safari/Chrome with the configured project and HTTPS origin. Check app-link
handoff, desktop QR scanning, connection rejection, cancellation followed by late
approval, custom-chain support, account/network changes, session expiration,
background/return, reload and disconnect. Complete the bounded live fee-to-vault
acceptance with the normal recovery checks. Browser emulation and a fixture peer
do not establish relay availability or real-phone compatibility.
