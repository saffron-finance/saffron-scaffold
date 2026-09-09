# Fixed-income URL contract

`createVaultUrlParams.mjs` is an unminified esbuild ESM bundle of
`packages/api-types/src/createVaultUrlParams.ts` and its `isUsdToken` dependency
from saffron-finance/fixed-income revision
`e0949447d985a3d161bb8c4cac8b01e91c29365a`.

No behavior was changed. The standalone server reuses the exact encoder and
pending-request mapper that fixed-income's admin queue and notification links
use. On integration, import these from `@packages/api-types` and remove this
snapshot. Source retains its upstream ownership.

Vault entry paths are the fixed-income `buildVaultDetailsUrl` contract at the
same revision: `/network/<slug>/vault/<address>/fixed` or `/variable`.
This feature accepts only its supported Robinhood chain (4663).
