# Funding and accounting

Each budget has four headline metrics followed by a compact details table.

- **Planning budget:** the current editable advisory USD target; fall back to the original campaign budget only if no edit exists.
- **Premium funded:** the existing observed premium-funding ledger, not the ETH request-fee total.
- **Cumulative premium requested:** total premium USD recorded on all accepted deployment requests.
- **Number of requests / LP requests:** accepted request records, not distinct wallets, transaction retries, unpaid quotes, or confirmed LP deposits.

The table shows average, maximum, and total requested fixed-side capacity (LP size) and requested premium. Historical failed, cancelled, and released requests remain in these cumulative statistics. Each accepted request counts once, regardless of payment or job state. Premium amounts exclude request fees and network gas.

Current reserved/funded capacity and observed LP entries remain separate from request history. **Remaining target LP capacity** is the original target minus current commitments; a negative value means above target, not a negative wallet balance. Original quote economics remain separate from the edited planning budget.

## API compatibility

The private catalog supplies an optional `budget.requestStatistics` projection with `scope: all-accepted-requests`, an exact decimal-string `requestCount`, and `totalLpCents`, `averageLpCents`, `maximumLpCents`, `totalPremiumCents`, `averagePremiumCents`, and `maximumPremiumCents`. Monetary values are request-time USD cents; averages round to the nearest cent. No floating-point money calculations are used.

Missing projections display Unavailable. Empty history has zero totals and no average/maximum. If a historical valuation is missing, its dimension remains unavailable instead of silently aggregating a partial history; `unvaluedLpRequests` and `unvaluedPremiumRequests` identify those cases. These operator-only statistics must not be included in the public offer feed.

## Checks

`npx vitest run src/incentives/FundingAccounting.test.tsx src/incentives/CampaignManagement.test.tsx src/incentives/IncentivesAdmin.test.tsx`

After building, `npm run test:campaign-management` exercises the compiled frontend with a disposable in-memory HTTP fixture at the build's declared base path. It checks request statistics, edited planning values, missing versus empty data, all expanded disclosures at 1440/1024/768/390/320px, and existing editing/navigation. It starts no chain or database and writes nothing to production. Backend aggregation is maintained and verified separately by the API operator.
