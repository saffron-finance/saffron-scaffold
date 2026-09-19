# Incentive programs

The application and Server Admin use the same program directory pattern: search, two-column summary cards, and one selected program at a time. Disabled and paused programs remain visible. Cards show pair, duration, APR, exact ETH request fee, status, and program reference. Server Admin owns readiness checklists; the application owns configuration and funding/accounting.

## Pages and navigation

- `/incentive-programs`: searchable directory and per-program details.
- `/incentive-programs/new`: separate creation page; opening it never creates a program.
- Administration → **Incentive programs**: the same directory component.
- Server Admin → **Incentive programs**: independent program readiness and manual responsibilities.

Old `/campaigns`, `/campaigns/new`, and `?view=campaigns` bookmarks redirect to the current pages while retaining other query parameters and fragments. Existing Server Admin program links continue to resolve.

## Compatibility, not a financial migration

Persisted IDs, the `budget.campaign` economics field, `/admin/campaigns` creation endpoint, request signatures, idempotency keys, and existing funding/withdrawal recovery keys are intentionally unchanged. These are internal compatibility contracts. A historical `campaign-…` ID is displayed as `program-…`, with its full suffix retained. Never send this display reference back as a replacement ID: all edits use the original catalog record.

Server prose is translated at display boundaries only; no recursive response rewriting or database migration is used. Configuration revisions, exact wei fees, shared-budget pause semantics, historical request statistics, and wallet authorization remain independent of naming.

## Regression checks

Tests were written before implementation. The UI suite covers program search/selection, full identities, exact fees, dirty revision conflicts, failed reads, removed programs, and creation retries with the original idempotency key. The compiled browser fixture covers new/old routes, query/hash preservation, all app pages, the embedded admin tab, expanded disclosures, and 320–1440px layouts, with zero production transactions.

Run `npm test`, then build and run `npm run test:incentive-programs` in the merged frontend. Use the separately managed API's own non-chain compatibility checks; this UI refactor does not authorize starting a local test chain.
