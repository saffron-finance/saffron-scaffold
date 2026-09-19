# P3 program workspace and R1 refund review

## Incentive programs

The manager and Administration tab share a persistent, searchable program navigator. Select a program to edit it alongside the list; narrow screens stack the list and details. APR uses gold, selection and outlined actions use the shared purple controls. Primary actions retain appearance preferences.

Request fee and planning target remain independent saves, with exact wei and original optimistic revisions. Selecting another program does not reuse the previous program's dirty drafts. Paused/disabled programs remain discoverable; failed catalog reads disable editing. Full program references remain visible. Creation remains a separate page. Funding & accounting and pair management remain available, without replacing Server Admin's readiness checks.

## Refund requests

R1 separates request selection and approval from external payout preparation and verification. Data is loaded explicitly. A failed refresh retains the last evidence but blocks approval/preparation until a successful read.

Headline counts describe the loaded candidates and latest batch list, not unbounded server totals. Submitted batches are not necessarily awaiting or completing repayment; inspect batch evidence for the actual verification status. Exceptions are labeled separately from approved requests. All fee sums use bigint wei and display exact ETH. The overall selection total includes all selected candidates, while the approval subtotal includes only reviewable requests.

Approval retains the original revision and idempotency key, needs an explanation and stopped-funder confirmation, and never sends ETH. Preparing a batch still requires an external sender and approved/exception requests. Original frozen CSV, transaction hash submission, partial/unmatched evidence, superseded blocking and remaining-amount reconciliation retain their existing API contracts. No backend, signer or financial migration is part of this layout change.

## Checks

Baseline and refund contract tests were written before implementation, followed by failing P3/R1 acceptance cases. Run `npm test` and `npm run build`, then `npm run test:admin-workspace`. The compiled browser fixture exercises desktop/narrow layouts, keyboard navigation, exact fee writes, program switching, separate creation, refund approval/preparation/CSV/hash verification and failure handling. It uses disposable in-memory API records and a local fixture wallet, never a production signer or test chain.
