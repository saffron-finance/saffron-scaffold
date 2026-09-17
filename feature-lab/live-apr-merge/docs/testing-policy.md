# Test lanes and coverage accounting

The imported audit files are **proposals**, not an executable 748-test suite.
The expanded catalog includes the original 620 proposals; adding their counts
would double-count 620 entries. The app/repository catalog contains 716 entries;
32 additional proposals belong to the separate private APR service.

## When to run

- While editing: run the affected file or component tests after each meaningful
  behavior change. Preserve a failing regression before the fix where practical.
- Before a code commit: `npm run test:fast`. Runs unit/hook, type, source pin,
  archive and release checks with four Vitest workers. Documentation-only commits
  need their relevant validation, not a mandatory browser rebuild.
- Before merging or releasing wallet/auth/accounting changes: also run the
  corresponding real disposable database/EVM checks in their owning backend.
- Before deploying: build the actual candidate, exercise the applicable compiled
  browser lanes, inspect release identity, then perform a read-only hosted smoke.
- Native transport ownership: `npm run test:lane:native`. Uses actual Chromium,
  loopback HTTP, cancellation and a working follow-up load. No deployed backend.
- Public checkout/API browser checks: `npm run test:lane:public`. Requires a
  current `dist-live` and explicit `SAFFRON_BACKEND_SOURCE` plus disposable
  `SAFFRON_TEST_DB_*` settings. The runner never starts a production database.
- Private host features: `npm run test:lane:host`, with
  `SAFFRON_TEST_BACKEND_KIND=host` and the matching private application-source
  fixture checkout. Funding-context and intake policies are not implemented by
  the historical public backend; pointing at it is a mismatch, not a pass.
- Download/caching/recovery: `npm run test:lane:downloads`. Includes its explicit
  test-only build. Run for bootstrap, branding, dynamic-import or export changes.
- Release/scheduled runs: supported Node/OS/browser matrices and multi-tab
  resource soaks. These complement, not replace, fast commit checks.

Each lane stores complete output under ignored `validation/test-lanes/` and
prints compact successes plus failure details. Running npm/Node/Python tests
consumes CPU and time, **not model tokens**. Agent interpretation and included
log output use tokens; output bytes are a measurable proxy, not exact billing.

## Counts are not interchangeable

Report runner case instances, unique reviewed behavior contracts and catalog
coverage separately. Parent suites, matrix reruns, duplicate relay variants,
unit/native checks of the same invariant, and cosmetic input variants do not
create additional unique contracts. A passing test that lacks an explicit
proposal mapping is not automatic proof of that proposal. Skipped, discovered,
manual and proposed-only cases cannot satisfy the 500-contract implementation
gate. Adopt that gate only after reviewed evidence binding, not from a title scan.

A self-consistent source manifest establishes integrity, not authorship.
For a release obtained from another channel use
`python3 scripts/verify_source.py archive.zip --expected-sha256 TRUSTED_DIGEST`.
Obtain that digest independently; a digest shipped inside the same archive is
not an external trust anchor. Path/link/duplicate/member/expanded-size checks run
before extraction, including under Python optimized mode.

## Security and modularity

Keep private API, worker, operator and APR-service implementations in their
no-remote source repositories. Publish browser tests and portable tooling only
through the reviewed frontend export. Keep test fixtures synthetic and local;
never import a production signer or pay real fees for regression testing.

Runtime APR configuration accepts same-origin HTTP paths only. Deploy a
same-origin gateway for externally hosted APR services; control requests refuse
redirects. Configured external navigation accepts HTTP(S) without credentials,
with no HTTPS downgrade; it does not authorize API or wallet requests.
