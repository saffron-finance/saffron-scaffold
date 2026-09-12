# Version 0.3.0 release acceptance

> Historical 0.3.0 acceptance/adoption record. Version 0.4.0 removes the browser
> simulation and requires wallet/API flows in every build. See README.md and
> WALLET-ONLY-FIXED-FEES.md for the current behavior.

The candidate includes the automatic fee-to-vault lifecycle, external premium
funding, fixed-side entry, premium claim, mature withdrawal, payment recovery,
operator-verified external refunds and the combined mobile/desktop interface.
Deployment and real-fund qualification are separate operating steps.

## Automated evidence

Reports identify the actual source revision and asset digest rather than relying
on a version label alone. Keep the final clean-source ZIP/manifest, build marker,
backend revision and CI reports together in the release record.

| Boundary | Maintained evidence |
| --- | --- |
| Source handoff | Allowlisted ZIP, exact hashes, normalized source identity, 32 shared-source pins, lockfile and guide version; clean extraction with installation, source/unit/type checks and all three builds |
| Release integrity | Root/nested HTTP checks, live appearance variants, preview rejection, entry/lazy-asset integrity, wrong source/base, HTML API fallbacks and missing recipient |
| Served browser | Actual canonical proxy/API/database with a disposable EVM; navigation, checkout cookie/Origin, operator separation, closed/open readiness and no jobs or wallet broadcasts |
| Full lifecycle | Desktop/mobile real API/EVM journeys with automatic creator, lost callback recovery, partial/full premium funding, fixed deposit, claim and mature withdrawal; APR unavailable throughout |
| Refunds and restore | Original-fee settlement, qualified atomic bulk-sender runtime, partial/repeated/reorganized evidence, permanent execution stops, and real PostgreSQL dump/restore preserving allocations and audit history |
| APR contracts | Unit invariants plus controlled HTTP/SSE comparison, idempotent admission, history, presence, bfcache, reconnect, unavailable state and release; separately labelled from a live gateway |
| Preview and mobile | Compiled simulation isolation, responsive navigation/dialogs and PNG pixel checks; these do not establish real phone or normal clipboard permissions |

`test:release-browser` reports `fixtureOnly:true`, `liveGatewayQualified:false`,
`liveFundsTested:false` and `realPhoneTested:false`. Its explicitly permitted
dirty build checks are for iterative fixture testing only. Operator CLI checks
require clean source and can pin the approved exported source manifest.

The source package builds independently. Integration tests additionally need
this repository's backend test package, PostgreSQL, Chromium and the bundled
disposable EVM. CI covers the frontend/source handoff on Node 22 and 26 across
Windows and Linux; a single development run does not establish every CI result.
Existing large-chunk build notices remain advisory; they do not indicate a
simulated payment adapter or qualify mobile performance.

## Launch gates still pending

- Configure actual campaigns, fee recipient, protected protocol/RPC/creator
  settings, watcher identity/start block and a separate database. Assign creator,
  external funder, refund/recovery and cutover owners with supported coverage.
- Supply the actual origin/mount and hosting access. Run the source-pinned
  preflight and browser smoke through that reverse proxy with intake closed.
  Record successful access and application authorization boundaries separately.
- Qualify the existing APR endpoint/owner, session headers, comparison/reconnect,
  committed chain freshness and unbuffered SSE. Record ordinary HTTPS clipboard
  success or its permission failure. Fixtures do not qualify that deployment.
- Test the supported real wallet browsers/phones on Robinhood, including network
  selection, wallet confirmation, background/return and ownership recovery.
  Configure the Reown project ID/origin allowlist and qualify WalletConnect QR
  and mobile app-link pairing with a real relay; fixture peers do not prove it.
- Record an exact eligible rollback frontend/backend pair and verify a backup
  clone against it. Retain the 0.3.0 live UI for request recovery with intake closed.
  The earliest eligible backend baseline and data invariants are in `LIVE-CUTOVER.md`.
- Operate a bounded live acceptance run: one actual fee, automatic creation,
  external premium funding, fixed entry, start, premium claim and withdrawal after
  real maturity. Publication, intake enablement, phone qualification and live-fund
  testing have not been established by the automated implementation checks.

No release-check command publishes assets, opens intake or invokes a signer.
