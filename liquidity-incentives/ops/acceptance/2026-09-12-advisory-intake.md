# Advisory intake and maintained VNC harness — 12 September 2026

## Change

Integrated on `feat/one-shot-vault-watcher-20260911` after `8c912ee`.

- Commit the portable Linux/systemd VNC harness, configuration, reset/archive,
  refresh/reopen controls, and their maintenance instructions.
- Remove all campaign/premium, per-user, per-browser, and queue admission quotas.
- Make internal planning targets advisory. Only the authenticated operator
  portfolio shows the 90% near-capacity notice. No public or modal notice exists.
- Retain a separately editable planning budget without repricing existing quotes.
- Remove C05, amount review, refund/retirement workflows, gas-spending ledgers,
  and treasury inventory/balance checks. Refunds are manual external operations.
- Keep C06, independent payment discovery, multi-request browser recovery,
  canonical vault funding checks, and user LP recovery/claim/withdrawal.
- Keep exact transaction bounds, nonce/journal recovery, protected one-request
  permits, and mandatory reviewed-request fork simulation.

## Executed validation

All tests used disposable PostgreSQL databases, local contracts, and generated
wallets. No live-chain signing or funding was performed for this release.

| Check | Result |
| --- | --- |
| Normal TypeScript/Vite build | Passed |
| Unit suite | 36 passed |
| Database/API suite | 25 passed |
| Lifecycle and real Uniswap suite | 14 passed |
| Watcher/one-shot/protected-worker suite | 15 passed |
| Real backup/restore regression | Passed |
| Production browser suite | 15 passed |
| VNC regression files | 3 passed, 27 subchecks |
| Lab build and approved-card browser check | Passed |
| Preview build and static-only browser checks | Passed |
| Disposable demo startup smoke | Passed |

Notable cases: 120 concurrent paid requests by one wallet; commitments above
former raw/USD targets; old SQL constraint upgrade without record loss; private
portfolio-only notice; independent recovery in stale tabs; lost wallet/payment
responses without a second fee; exact-request fork simulation; complete
payment-to-withdrawal lifecycle; restored old state detecting later signer use.

Browser verification exposed and fixed asynchronous modal focus restoration.
The watcher-recovery test now waits for canonical admission before its explicit
Check payment action; it no longer assumes removed C05 polling is present.

Linux tests ran locally. Windows CI remains configured for core builds, unit
checks, native Anvil availability, and protected-file handling. This release does
not claim a fresh local Windows execution. VNC hosting remains Linux-only.

## Upgrade and rollback

A verified Git bundle, pre-change Git anchor, encrypted non-Git files, and encrypted
consistent QA database/chain/permit archive were taken before modification.
Their host-specific locations are recorded locally, outside this repository.
The prior populated browser session is retained while the new harness is staged.
The new host passed two real Refresh clicks without a session change, actual
noVNC/RFB keyboard navigation, encrypted archive verification before an actual
reset, and a delayed repeat reset that preserved the successor. The fresh test
had zero requests, user transactions, creator broadcasts, and clock advances.
A loopback edge exercised wrapper/viewer routing without credentials; public
authentication is checked separately.

Schema upgrades preserve deprecated historical tables and old accepted terms.
New databases do not create removed modules' tables. Rollback after above-target
commitments needs a deliberate data plan; reinstating the old SQL hard constraint
may fail. Do not erase paid records or restore spent permits as new authority.

Follow [VNC operations](../vnc/README.md) for exact host installation, verification,
archival, reset, and upgrade procedures. Refresh does not start a fresh test.
