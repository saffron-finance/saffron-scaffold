# Wallet preparation and recovery

Silent wallet reads have a 15-second deadline and no automatic retry. Gas
estimation, nonce/account/chain reads, and the position controller's context
reads cannot keep the same-wallet Web Lock indefinitely.

Each explicit action owns a revocable preflight scope. Closing/unmounting the
review, replacing its account/deployment/mode, or a read timeout invalidates
that scope. Every asynchronous continuation checks it, including immediately
before the durable intent and send. Late replies cannot update the review or
submit a transaction. Network-switch prompts allow human response time but
can be cancelled by closing the review; late responses cannot start another
prompt or send.

Action buttons remain disabled during preparation, but Close stays available.
Once submission begins, the dialog shows the separate confirmation state. The
intent is persisted before the one wallet send. A lost response retains the
intent and nonce for recovery; no timeout, close or automatic retry turns it
into another transaction. Receipt verification and transaction matching remain
unchanged. This is frontend-only; server execution is unaffected.

## Verification

- `npm test`: real viem/provider adapter with held promises and fake time;
  estimate/nonce/account/chain stalls, close/reopen, account replacement, late
  context responses, cancelled network prompts, and durable unknown sends.
- `npm run test:wallet-preflight`: compiled browser UI with actual Web Locks,
  held selected-provider reads, desktop close, mobile timeout, and successful
  approval/funding on a disposable local EVM. Set `SAFFRON_BACKEND_SOURCE` to
  the separately supplied test backend and `MERGE_DIST` to the built frontend.
  Database connection settings belong in that private test environment.

Neither suite connects to a production wallet or sends production transactions.
