# Deployment and rollback

## Preview publication

1. Back up the current static directory, its manifest and route configuration.
   Create and verify a Git bundle. Preserve browser storage and any VNC test state.
2. Run the unit, source-pin and compiled-browser checks. Build with the intended
   base and APR API settings. `build:lab` is explicitly a simulation; its output
   does not establish the currently published mode.
3. Stage only `dist/`, the source ZIP and installation guide. Keep authentication,
   extensionless SPA fallback and real 404 responses for missing asset files.
   Do not change the existing APR gateway, collector, databases or VNC services.
4. Publish assets before replacing index.html. Keep old hashed assets for users
   who still have an old tab open. Verify deployed file hashes against the build.
5. Verify the mounted app, Portfolio, Campaigns and Live APR. Distinguish fixture
   checks from authenticated public interaction. No keys or passwords go in URLs.

## Public API-connected release

Build `build:live` to `dist-live/`, then set the canonical backend's `DIST_DIR`
to the absolute output path. Frontend `VITE_BASE_PATH` and server `BASE_PATH`
must match. The same-origin server handles incentives API, RPC and price routes
before static SPA fallback. Use its supported protocol and database configuration.
The backend source is this repository's `liquidity-incentives` package. Use a
compatible revision with automatic creation and external-refund closure.

A GET/HEAD-only static route is not a deployment of the API. Do not publish a live
build there and claim paid requests work. API mode has real wallet actions and
no sample fallback. Deploy its backend only for an explicitly selected environment.
Keep the existing read-only APR endpoint separately configured.

## Rollback

Restore the previous index and static manifest from backup. Retained content-hash
assets make this independent of Git rollback. If route configuration was changed,
restore it, run the nginx validator separately, then reload the exact service.
No route change is needed for this preview update.

Do not clear browser storage, reset VNC, restore a database, or replace live APR
services to roll back a frontend update. The preview storage key is unchanged.
Git rollback alone does not replace already published files.

## Source package

Run `python3 scripts/render_install.py` after editing `docs/install-guide.json`.
Run `python3 scripts/package_source.py /path/to/live-apr-merge-source.zip` after
final source edits. The package excludes installed dependencies, build/test
outputs, local settings and backend credentials. Validate its source manifest
with `python3 scripts/verify_source.py /path/to/live-apr-merge-source.zip` before
publication. `--extract /new/directory` verifies first and extracts to a new path.
From its `live-apr-merge` folder run `npm ci`, source checks, unit/type checks and
default/lab/live builds. The archive builds without a backend checkout.

`source-files.json` supplies the allowlist shared by packaging and build identity.
The guide model and generated header, contents and sections must agree with the
package version. The archive manifest records exact file hashes and a normalized
source digest, separate from the historical shared-source adoption pins.
