# Deployment and rollback

## Preview publication

1. Back up the current static directory, its manifest and route configuration.
   Create and verify a Git bundle. Preserve browser storage and any VNC test state.
2. Run the unit, source-pin and compiled-browser checks. Build with the intended
   base and APR API settings. `build:lab` is the current published mode.
3. Stage only `dist/`, the source ZIP and installation guide. Keep authentication,
   extensionless SPA fallback and real 404 responses for missing asset files.
   Do not change the existing APR gateway, collector, databases or VNC services.
4. Publish assets before replacing index.html. Keep old hashed assets for users
   who still have an old tab open. Verify deployed file hashes against the build.
5. Verify the mounted app, Portfolio, Campaigns and Live APR. Distinguish fixture
   checks from authenticated public interaction. No keys or passwords go in URLs.

## Optional API-connected deployment

Build `build:live` to `dist-live/`, then set the canonical backend's `DIST_DIR`
to the absolute output path. Frontend `VITE_BASE_PATH` and server `BASE_PATH`
must match. The same-origin server handles incentives API, RPC and price routes
before static SPA fallback. Use its supported protocol and database configuration.
The backend source is `saffron-finance/saffron-scaffold`, tested at `19ad0e9`.

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
before copying it into the published app directory.
