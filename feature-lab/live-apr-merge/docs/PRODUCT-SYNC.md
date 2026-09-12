# Product integration — 12 September 2026

The watcher/VNC release did not update this separately built frontend. Version
0.2.0 closes that source/deployment gap while retaining its approved UI and APR
feature. The old source was `93fcab6`; the reviewed backend head is `19ad0e9`.

## Commit coverage

These 26 commits are not 26 frontend features. Backend services remain in the
canonical `saffron-finance/saffron-scaffold` repository. Live mode uses that API;
the published lab mode adapts product screens to explicitly simulated data.

| Commit | Treatment in this integration |
| --- | --- |
| `4dd914d` | API contract: canonical watcher and request-pinned execution; exercised by backend browser test. |
| `1786774` | Retain backend regression/live-deployment evidence; not a frontend feature or a new live test here. |
| `bc2807b` | Backend protected-file Windows/Linux support stays upstream. No new Windows execution claimed. |
| `9512d21` | Imported durable, multi-tab payment ledger and recovery hook. |
| `31a27e4` | Keep canonical unpaid quote recovery; quota/hold limits superseded by `f9a47ac`. |
| `8a20f16` | Preserve canonical admission and idempotency; capacity reservation gates superseded. |
| `7bb139a` | Preserve canonical payment exception/recovery state. No refund-request workflow. |
| `45a89dc` | Refund verification workflow intentionally omitted, superseded by manual refunds. |
| `cb2a807` | Imported current intake-versus-worker readiness controls. |
| `b781e30` | Treasury/gas-coverage gates intentionally omitted, superseded by `f9a47ac`. |
| `5215c94` | Imported shared status polling and deployment progress DTO. |
| `21dfa95` | Imported C06 with four stages, elapsed time, outage handling and resume. |
| `73f0f8d` | Retain premium-funding readiness before LP entry; remove treasury inventory/brief workflow. |
| `a88ccc3` | Amount-review/user caps intentionally omitted, superseded by `f9a47ac`. |
| `e199714` | Adapted complete-cycle browser coverage to this actual merged frontend. |
| `8700a3b` | Imported verified start/maturity dates and current lifecycle panel. |
| `131c610` | Portfolio routes open the owned position inside this shared router. |
| `603ea8d` | Canonical backend owns bootstrap/schema; no database code copied into static source. |
| `fe7efaf` | Restore verification remains a backend operating requirement. |
| `3f9228b` | Retain focus/recovery regression coverage; preserve approved modal focus. |
| `0bf99f1` | Funding-brief workflow removed by later policy; campaign pause remains. |
| `261d5b1` | Canonical lifecycle runbook remains required for API-mode operations. |
| `8c912ee` | Existing acceptance evidence retained; fresh merged-UI evidence is separate. |
| `afbccb9` | VNC tools stay committed upstream; this static update does not reset the VNC environment. |
| `f9a47ac` | Imported unlimited paid requests, private admin planning advisory, and requested workflow removals. |
| `19ad0e9` | QA source/version evidence stays upstream; pins this integration's backend compatibility. |

## Intentional frontend differences

- The shared router, shell styling, Live APR module and approved Claim $X layout
  stay here. The generic watcher frontend does not replace them.
- Public capacity columns/meters disappear. Only admin Portfolio shows near/over
  target. Campaign administration can edit a private advisory budget.
- Default/lab builds have isolated sample data and no wallet calls. Sample C06
  states are explicitly marked; no fictional receipt hashes are shown.
- Explicit live mode uses unchanged canonical transport, payment hooks, polling
  and wallet adapters. The backend, not browser storage, owns request state.
- The live fee deadline remains enforced even though the approved review has no
  running countdown. See CLAIM-FLOW.md. Never promise an expired quote is payable.
- The imported Campaign ID pattern was fixed for modern HTML Unicode-set regex
  validation by escaping its literal hyphen. The browser suite caught this.

## Maintenance check

1. Compare new canonical commits against the backend pin, not only this UI's Git head.
2. Run `npm run check:upstream`. In the combined repository it also compares the
   current `liquidity-incentives` package automatically. A portable source archive
   verifies its own pins; an explicit backend path can be passed after `--`.
   Hashes normalize CRLF to LF only: code and other whitespace changes still fail.
   Update corresponding copies and their pins together after reviewing a change.
   Review adapted UI files separately. Run `npm run test:source` for drift checks.
3. Classify backend-only, frontend-applicable and superseded changes here.
4. Test normal/lab builds and the API-connected build before publishing.
5. Deploy the intended frontend explicitly. A successful VNC or watcher deployment
   is not evidence that this separate page changed.
