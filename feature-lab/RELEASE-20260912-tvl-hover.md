# Live APR merge 0.2.1 — TVL and modal hover

Published at the existing Live APR merge page on 12 September 2026.

- TVL follows Duration and uses the same cell typography.
- The 3-, 5- and new 7-day sample rows show $500,000, $700,000 and $900,000.
  These are preview placeholders, not budget/capacity figures or chain readings.
- The third sample is added without resetting saved requests or campaign edits.
- Enabled incentive-modal buttons brighten by 6% on mouse hover. This replaces
  the inherited 60%-opacity dim. Disabled controls and navigation are unchanged.

47 unit tests, normal/lab/live builds, 29 exact source pins and both 15-check
compiled browser suites passed. Browser checks include ten widths, both sidebar
states, TVL/Duration font equality, saved-state preservation and actual computed
hover brightness/opacity. The existing full backend lifecycle was not rerun for
this presentation/sample-only change; no mainnet or VNC state was touched.

All 105 deployed files were hash-verified. The 264-file source archive matches
the working source; SHA-256:
`1255686cf3f9b485aae4b9d4e670aa8c8a1bbc01b3c8564632e1ad5346d9128c`.

Before deployment, 185 prior files were backed up and their hashes verified.
Backup/evidence path relative to the Saffron workspace:
`feature-lab/live-apr-merge-work/tvl-hover-20260912/`.
Git rollback reference: `0c22e7cc08223baa4b643574badf0d879f008b62`.
Old hashed assets remain available. Authentication and server configuration did
not change. Public unauthenticated access returned the expected 401; interaction
checks used the matching compiled files on loopback, not an authenticated remote
browser session. Restore static files separately from Git if a rollback is needed.
