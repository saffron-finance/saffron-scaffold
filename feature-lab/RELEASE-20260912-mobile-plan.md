# Mobile design study and modal hover 0.2.2

## Delivered

- The existing merge app now uses `brightness(1.15)` on enabled incentive-modal
  mouse-hover buttons. Disabled styles, touch behavior and transaction logic
  are unchanged.
- `mobile-design-20260912/saffron-mobile-design-2026-09-12.html` is a complete
  offline design document in the existing Saffron style, with thirteen working
  HTML mockups, ten report sections and a phased implementation plan.
- Mobile layouts remain proposals. The mockups use in-memory illustrative
  state, never a wallet, API, database or real funds.

Published document:
https://clawbee.xyz/saffron/reports/saffron-mobile-design-2026-09-12.html

Existing app:
https://clawbee.xyz/saffron/apps/feature-lab/live-apr-merge/

## Verification

- The nested lab build passed; the compiled app's fifteen grouped browser
  checks passed, including the actual computed `brightness(1.15)` and opacity 1.
- All thirteen mockup frames render. The report verifier exercises amount
  preservation, request/C06 recovery, the LP action chain, claim and maturity,
  navigation, advisory placement, keyboard-space simulation, narrow viewports,
  disclosures, deep links and actual PDF print-state restoration.
- No unexpected network requests or JavaScript errors occurred during the
  report check. PDF text includes the closed late-plan sections and the
  maturity mockup. See `mobile-design-20260912/verification.json`.
- All 105 deployed app artifacts, including the source ZIP, match local
  hashes. The ZIP's 264 source files match the source tree.
- The published report matches the verified HTML, SHA-256
  `51eadeaba523fba799ae41dc12d20a432443c4b5852905dba0559d2e2fe36892`.
- The public URL retains the existing HTTP 401 login gate. Authenticated
  remote interaction was not checked; browser checks used the identical
  artifact on a local HTTP server. Real mobile devices and wallet return are
  implementation acceptance gates, not results claimed here.

## Operations and recovery

The previous static deployment was copied and hash-verified before changes.
Operator-local evidence/backup directory:
`saff/feature-lab/live-apr-merge-work/mobile-plan-20260912/`.
No database, service configuration, VNC session, fork or wallet was reset.
The document's Reset mockup button changes only its isolated in-memory state.

For report editing and regeneration, see `mobile-design-20260912/README.md`.
