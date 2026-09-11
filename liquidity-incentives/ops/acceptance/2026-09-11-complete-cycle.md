# Complete-cycle acceptance — 11 September 2026

**Result: passed on a disposable chain and databases.** Production runtime code
`261d5b1ef182c4b8c09f0c12918f51a3c0398d84` completed the paid campaign flow through
fixed withdrawal. [Public evidence](2026-09-11-complete-cycle.json) records the
request/plan/payment identifiers, three creation receipts, external funding
receipts, user actions, confirmed position state and final ledger.

This is not live Robinhood full-cycle acceptance. Generated accounts, test tokens
and chain state were disposable. The Saffron contracts and actual Uniswap V3
factory/position manager executed the lifecycle; the external USD provider and
injected-wallet boundary used test fixtures. The fixture's adapter type ID is 1;
that fixture registration is not a production factory type recommendation.

## Observed cycle

1. Empty bootstrap; operator API creates a $1,000 premium campaign with $100,000
   fixed-side capacity and a three-day duration, then assigns treasury inventory.
2. User requests $100 and pays the exact $2-equivalent native ETH fee. The browser
   acceptance callback is deliberately lost. The keyless watcher admits one request,
   and browser recovery restores it without another payment or message signature.
3. Reviewed mode has no queue-worker heartbeat. The exact request passes factory
   fork simulation, then its protected one-request permit executes precisely three
   creation calls. UI progress follows each confirmed milestone.
4. A separate treasury partially funds, then fully funds, the variable side.
   Unfunded/partial states stay unavailable for fixed entry. The waiting screen
   survives an API outage, retains progress and disables dependent actions.
5. The user explicitly enters the fixed-position view, wraps ETH, approves the
   intended assets, deposits the fixed side and claims the premium. The vault's
   actual start and maturity differ by 259,200 seconds. Treasury owns variable rights.
6. Only the disposable chain advances to maturity. The user withdraws through the
   same interface. Canonical withdrawal plus consumed claim/fixed rights and an
   empty LP position produce `completed`; repeat claim/withdraw are unavailable.

The run used **7 user transactions, 0 user message signatures and 3 creator
broadcasts**. Fork simulation broadcast nothing to its upstream. Closing/reopening
and callback recovery did not create another request or fee.

## Final accounting

| Quantity | Confirmed result |
| --- | --- |
| Campaign premium book | $1,000 total; $1 spent/funded; $999 available |
| Campaign fixed-side book | $100,000 total; $100 consumed; $99,900 available |
| Actual fixed deposit | $100 at request-time valuation, recorded separately |
| Unpaid holds / paid reserved premium | 0 / 0 |
| Allocated raw premium | `500000000000000250001` |
| Treasury variable bearer | `500000000000000250001` |
| User claim / fixed bearer balance | 0 / 0 after withdrawal |
| User position state | `completed` |
| Durable request state | `active`: its started/spent commitment remains consumed |

The raw premium conservatively rounds upward at the fixture pool price. The USD
book retains the accepted one-dollar premium rather than revaluing token balances.
Maturity/withdrawal releases no spent campaign budget or fixed capacity. The final
ledger audit passes, and both LP token balances increase from their post-deposit
values when withdrawn. Exact public balances and block hashes are in the JSON.

## Verification

| Gate | Result |
| --- | --- |
| Unit/security/payment records | 36 passed |
| Database/API/concurrency | 25 passed |
| Real-contract lifecycle/recovery/treasury | 15 passed |
| Watcher, one-request, gas, refund and protected-worker | 21 passed |
| Actual PostgreSQL backup/restore | 1 passed |
| Production browser suite | 15 passed |
| Lab cards/layout browser check | 1 passed |
| Demo smoke | Passed |
| Normal, lab and isolated preview builds | Passed |
| Static preview interactions and no live network/wallet calls | Passed |

The focus scenarios use independent checkouts per viewport so the tests preserve
watcher-based settlement of closed unpaid holds. A separate treasury regression
confirms that campaign pause suppresses funding recommendations. The restore test
backs up a paid queue, creates a vault after the backup, and confirms the restored
queue remains paused and broadcasts nothing when signer history no longer matches.

Source scans and documentation-link checks passed. Normal output was rebuilt after
lab verification. Vite retains the existing advisory for chunks larger than 500 kB.
Test automation covers both native ACL checks and protected signer configuration;
this report records executed checks, not a claim that a new remote CI run occurred.

## Remaining operational acceptance

Live activation still requires configured public-edge abuse protection, verified
RPC/pricing services, supervised watcher/API, reviewed factory/type configuration,
creator gas/subsidy policy, real treasury allocation and operational staffing.
Those values and funds are operator-owned, not supplied by a test fixture.

The [existing vault #2 record](../live-tests/2026-09-11-vault-2/README.md) remains
creation-only. A live full-cycle record requires its own actual user fee, external
premium funding, fixed deposit, claim and final matured withdrawal. No live signer,
treasury movement, publication or push was performed for this implementation.
