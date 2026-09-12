# Verification — 12 September 2026

- 47 unit tests passed, including the 43 retained APR contracts.
- TypeScript and normal, lab and API-connected builds passed.
- Both preview browser suites passed 15 grouped checks, including actual PNG
  decoding, ten-width layouts, capacity removal, multiple paid samples and
  admin-only advisory placement. No wallet/network fallback occurred.
- API-connected merged UI completed two independent paid requests. The first
  lost its callback and recovered after reload without paying twice.
- Exact fork simulation made zero upstream broadcasts, then three creator
  transactions ran on the disposable local EVM. C06 retained verified progress
  during an induced API outage. Partial funding did not enable LP entry.
- The first position completed wrap/approve/deposit/claim and mature withdrawal,
  with verified start/maturity dates. Eight user transactions include both fees.
  No message signatures were required. Final claim/fixed balances were zero.
- 29 exact imported files match the canonical backend pin.

The JSON files record the checks. This is Linux fixture evidence, not mainnet or
Windows end-to-end evidence. Generated wallets and isolated PostgreSQL/EVM state
were cleaned up. The existing VNC browser and its requests were not changed.
