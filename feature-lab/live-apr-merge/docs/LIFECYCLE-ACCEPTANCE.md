# Complete-cycle acceptance

Run `npm run build:live` with `VITE_BASE_PATH=/` and then
`npm run test:backend-browser`. Set `SAFFRON_BACKEND_SOURCE` to the absolute path
of this repository's `liquidity-incentives` package, with its test dependencies
installed. Supply a disposable PostgreSQL connection through `SAFFRON_TEST_DB_*`.
Run separately with `MERGE_DEVICE=mobile` and `MERGE_DEVICE=desktop`.

The harness starts the canonical API and a disposable EVM containing the adopted
protocol and real Uniswap position manager. Wallets and private keys are generated
only for the fixture. It creates a campaign through the existing operator API,
enables automatic intake, and exercises the ordinary queue creator. There is no
per-vault operator approval or request-pinned execution permit in this journey.

Evidence is written to `validation/backend-browser-<device>/verification.json`
and screenshots in the same directory. The desktop remains at 1440 × 1000 for
the full journey; mobile additionally checks widths 320, 390, 430, 599 and 600 and
a shortened amount-entry viewport. A shortened viewport is not a real phone
keyboard or wallet-app qualification.

The journey covers two independent ETH fees, a lost acceptance callback,
canonical watcher recovery, browser return, creation, retained milestones during
API failure, partial/full external premium funding, Portfolio entry, wrap and
approvals, fixed LP deposit, incentive claim and mature withdrawal. The report
records real fixture receipts, final ownership, execution mode and viewport;
`live:false` means it does not establish a production-funds lifecycle.

The backend package's focused suites add missing-hash same-nonce recovery,
recipient/payment verification, fee repricing isolation, creator interruption,
replacement reconciliation, bearer ownership transfer, pre-start LP recovery,
external refund batches and permanent closure. Its real PostgreSQL dump/restore
test preserves refund allocations and verification history and prevents a
refunded request from becoming creator work after restart. Refund remainder
tests enforce each frozen allocation and reject uncertain earlier manifests.

## Remaining launch qualification

Qualify selected real phone/wallet browsers on Robinhood, including background
return and actual wallet confirmation. Verify the hosted reverse proxy and
separate APR gateway independently. Configure campaign terms, operating owners,
service coverage and intake before any live pilot. A real fee, automatic creation,
external funding, deposit, claim and withdrawal after real maturity remain an
explicitly operated launch gate. Disposable time advancement does not complete it.
