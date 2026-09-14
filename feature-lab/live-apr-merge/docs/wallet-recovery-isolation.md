# Wallet recovery and independent portfolio reads

## Behavior

- New wallet actions retain an immutable action ID in the existing recovery
  record. Older records remain readable; there is no storage migration or reset.
- Recovery and submission use the same existing per-wallet Web Lock. Recovery
  rereads storage under that lock and compares the reviewed action. Every hash
  update and removal also compares the exact prior storage value. An old tab or
  late receipt cannot replace or delete a newer record.
- Other-tab storage notifications and same-tab events refresh pending state.
  Notifications only read evidence: they never authorize another transaction.
- Vault rows, payment history, and session discovery load independently. Failed
  auxiliary reads show their own notice without hiding healthy vault rows or
  disabling their actions. A failed primary vault read retains its existing
  verification-unavailable behavior. The server still authenticates all writes.
- Existing preflight cancellation, signature prompts, transaction checks,
  receipt recovery, and intake revision handling remain unchanged.

## Verification

Run `npm test` and `npm run build`, then use an isolated backend fixture checkout
with disposable PostgreSQL and EVM support:

```bash
SAFFRON_BACKEND_SOURCE=/absolute/path/to/isolated/backend MERGE_DIST=dist npm run test:high-recovery
SAFFRON_BACKEND_SOURCE=/absolute/path/to/isolated/backend MERGE_DIST=dist npm run test:wallet-preflight
SAFFRON_BACKEND_SOURCE=/absolute/path/to/isolated/backend MERGE_DIST=dist npm run test:intake-policy
npm run test:downloads
```

Supply the test database settings required by that fixture. Never point it at
production. The first browser test uses two tabs, a real shared wallet lock, and
locally mined lost-response transactions. It proves stale-tab recovery cannot
erase or overwrite the subsequent action, and payment/session outages leave
portfolio actions usable at desktop and phone widths. Unit tests additionally
cover late confirmation callbacks, legacy records, same-tab events, primary
versus auxiliary failures, and stale wallet responses.

The separate backend is not included in this frontend export. Its intake write,
trusted-ingress rate limits, and background campaign probes require independent
backend deployment; publishing this UI does not imply those changes are installed.
