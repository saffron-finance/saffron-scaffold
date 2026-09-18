# Campaign management

- `/campaigns` manages existing programs. Each row includes its full persisted ID, immutable terms, advisory USD budget, fixed ETH request fee, and pause/resume control. Narrow screens use labeled cards.
- `/campaigns/new` is the separate creation page, including direct-link reload support. Both manager and administration buttons lead here.
- Funding/accounting is grouped by budget to avoid counting shared budgets twice. Orphan historical budgets remain manageable. Pair setup and shared-service diagnostics are separate disclosures.
- Fee and planning edits keep their original revision while dirty. A changed server revision requires choosing the latest value before resubmission. ETH values remain exact decimal/wei strings.
- Creation uses the unchanged atomic API and keeps an idempotency key across retries. The calculated economics field is excluded from the payload; only two input values are submitted.
- Enabled programs still depend on shared intake and service readiness. Planning targets are not request limits; fee revisions do not reprice existing payments/refunds.

## Focused checks

```sh
npx vitest run src/incentives/CampaignManagement.test.tsx src/incentives/IncentivesAdmin.test.tsx
npm run build
npm run test:campaign-management
```

The browser check serves the compiled `dist` at its declared base path using a disposable, in-memory HTTP fixture. It does not run a chain or database. `MERGE_DIST` and `MERGE_EVIDENCE` optionally select the build and artifact directory. No production write or wallet transaction is permitted. Fixture interaction checks are separate from hosted acceptance.
