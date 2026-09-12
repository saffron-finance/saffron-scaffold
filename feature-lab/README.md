# Feature Lab frontend deployments

## Live APR merge

The complete frontend is tracked in [live-apr-merge](live-apr-merge/README.md).
Its first combined-repository import is standalone source commit `c1d55ca`,
version 0.2.0. It integrates incentives changes through `19ad0e9`, including the
product-policy removals, while preserving the approved shell and Live APR module.

Published app: https://clawbee.xyz/saffron/apps/feature-lab/live-apr-merge/

This path is distinct from the [VNC QA tool](../liquidity-incentives/tools/qa/).
A successful watcher/VNC build or deployment does not update the merge page.

## Maintenance

- Treat this repository folder as the durable shared source. Review applicable
  frontend changes whenever the incentives API, hooks or product policy changes.
- Run the frontend README's tests and source-pin check. Build the intended mode
  explicitly. Default/lab are no-funds previews; live mode uses the canonical API.
- For local backend integration, set `SAFFRON_BACKEND_SOURCE` to the sibling
  `liquidity-incentives` package and use its disposable test fixture settings.
- Back up and publish the static build separately. Do not reset VNC, overwrite
  live database state or alter the APR gateway for a frontend update.
- Keep the source ZIP and install guide aligned with the deployed source.
  The original standalone VPS checkout is retained at the matching release;
  there is no automatic deployment or synchronization between working copies.

The import used a Git subtree so the combined branch contains the frontend and
backend together. The subtree contents match the tested standalone source.
Follow [deployment/rollback](live-apr-merge/docs/DEPLOYMENT.md) and the
[26-commit product map](live-apr-merge/docs/PRODUCT-SYNC.md), not an assumed
one-to-one mapping between backend commits and frontend features.
