# Authorized operator vault deployment — 2026-09-11

Status: deployed and independently verified on Robinhood Chain 4663.

- Request: `79229eb4-970a-4248-ba37-307bcd5eb174`; explicit operator authorization; private conversation identifiers omitted.
- Vault #2: [0x563008f7a958042429df7649f77a0c142fc36736](https://robinhoodchain.blockscout.com/address/0x563008f7a958042429df7649f77a0c142fc36736).
- Adapter: `0x500cb4d46b2b96b6c4671f88d8100e28819ed93b`.
- Factory: `0xce97ee64ad415976c465a783725014e67832be1a`.
- Creator EOA: `0xF70cE2bd96C83c8C9e0Cb0Ff7376F2d93E016612`.
- CASHCAT/WETH 1% pool, full-range ticks -887200 to 887200.
- $100 live LP sizing at 2026-09-11 02:08:32 UTC; raw liquidity 2449866550870314843. USD value and deposit amounts can move after sizing.
- Exact premium capacity: 499.999999999999999727 CASHCAT (18 decimals).
- Duration: 259200 seconds, three days after vault start. Factory fee: 1250 bps.
- Initialized, unfunded, no fixed LP deposited, not started. No user wallet reserved or assigned.
- Gas spent: 0.001365461773476 ETH. Latest/pending EOA nonce: 3 / 3.
- Independent verification: 2026-09-11T02:22:49.326Z, canonical block 59899434, hash 0x757399f3c58d1a276184d3a6842713b088cd3f536c390645e4479b740e8293b3.

## Live transactions

- create-adapter: [0xdb383df42a0bde92e569c4a2d3bf6881254807990bfea8f228d8667dbc8b9fde](https://robinhoodchain.blockscout.com/tx/0xdb383df42a0bde92e569c4a2d3bf6881254807990bfea8f228d8667dbc8b9fde); nonce 0; successful canonical receipt.
- create-vault: [0x98892c10dfba37dec335062616a1b73ddfc0e6ca5bfb344addcd54f903f45d76](https://robinhoodchain.blockscout.com/tx/0x98892c10dfba37dec335062616a1b73ddfc0e6ca5bfb344addcd54f903f45d76); nonce 1; successful canonical receipt.
- initialize-vault: [0x5663eabf5dcf188b701a46a27e0c80ccca7b9befa02844ed6ff0915782bec03b](https://robinhoodchain.blockscout.com/tx/0x5663eabf5dcf188b701a46a27e0c80ccca7b9befa02844ed6ff0915782bec03b); nonce 2; successful canonical receipt.

## Scope and verification

- A requester public wallet is not a factory deployment argument. The earlier identity blocker was incorrect: the shared reader only needs an observer for balance queries, and the zero address was explicitly used solely for that read-only purpose.
- This was a separately labeled operator-authorized deployment. The preview UUID remains a local reference, not a paid API job. No native payment evidence or user identity was fabricated; production databases and the browser preview were not modified.
- Exact funded-EOA factory-fork simulation passed with zero upstream broadcasts. Nine separate local-fork recovery/scope checks passed, using a disposable fixture account and no live signing key.
- The first two broadcasts did not initially yield visible transactions, and the second was confirmed to be below the then-current base fee. Their legacy quotes had no base-fee headroom. Each was later broadcast byte-identically when the base fee allowed it: no replacement signatures, no additional nonce, and no extra vault. The initialization call added headroom within the original gas budget; recovery tests were rerun after that change.
- Independent read-only checks verified all three receipts, exact calldata, factory registrations, code hashes, pool/range, fixed liquidity, premium, duration, empty funding/LP state and EOA balance accounting.
- Completed live-permit replay made zero signing calls and zero RPC calls. The permanent permit is spent; never erase or reset its state to reuse this authorization.
- Deployed using watcher base commit `4dd914de0c2b148e7c297e7fc5c5bb900b0d8a8c` plus the separately tested operator path; ordinary signing mode remained disabled. This does not prove live native-payment detection.
- Task-specific operator code/evidence is in this directory. Protected signed journal remains outside the report in the owner-only signer state directory. Never publish that journal.

## Repository evidence and reproduction

- `job.json`: exact live sizing inputs, USD source, immutable pool/token terms and raw capacities. Private actor identifiers were replaced with a public operator-approval marker; the recorded original `plan_hash` commits to the private authorization snapshot and is retained as historical provenance, not recomputed from redacted JSON.
- `simulation.json`: successful exact-EOA Anvil fork at block 59891027, before any real signature; all contained transaction hashes are simulation-only.
- `execution-test.json`: nine recovery/scope checks on a separate actual-factory fork with an ephemeral fixture wallet; not real-chain transactions.
- `live-result.json`: all three actual transaction hashes and full public receipts, contract registrations, code hashes, token/bearer addresses and final terms.
- `verification.json`: independent read-only chain verification and zero-signature/zero-RPC completed-permit replay.
- `operator-execution.mjs`: portable import-only reference of the exercised operator path. Changes from the local file are import portability and replacement of private actor/message checks with an explicit `operatorApproved` marker. No live entry point or signer config is distributed; the ordinary paid watcher never imports this path.
- Recovery records: identical saved hashes were accepted without replacement signatures.
- `manifest.json`: SHA-256 checksums of the published evidence. No private key, mnemonic, authenticated RPC URL, raw signed transaction bytes, database credentials or protected permit/journal is included.

Run `npm test` and `npm run test:watcher` from the package for the new public-evidence, gas and recovery regressions. Database/EVM tests use only disposable local fixtures. The exact-factory fork before future live signing remains mandatory in `worker:one`; the fork simulator now uses the same gas-headroom policy as the creator.

This historical success is **creation and initialization only**. It is not evidence of native-payment detection, premium funding, a user LP deposit, or a live-linked browser preview.

## Regression validation for this commit

- **68 Node tests passed**: 30 unit/public-evidence, 15 database, 12 lifecycle and 11 watcher. This adds **15 new regression cases** and expands the real-contract test with a missing-requester observer check.
- **11 normal browser scenarios**, **1 lab browser scenario**, both builds and the demo smoke test passed.
- Portable actual-factory fork reproduction passed all **9 recovery/scope cases**, with zero upstream broadcasts and no live signer loaded.
- `validation.json` records the suite breakdown; `repository-fork-reproduction.json` records the portable fork rerun. Historical deployment evidence remains frozen and distinguishable from these local-only tests.
- Production fee quotes and the exact-factory simulator now share `worker/gas-policy.mjs`. An RPC outage remains retryable; exceeding a configured fee ceiling still fails closed. Already-signed transactions are not repriced.
