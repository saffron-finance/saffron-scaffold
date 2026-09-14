# Revision-bound intake editing

The intake editor captures the complete saved policy and its revision together.
It initializes execution mode, watcher identity and declared service duration
from that policy, not deployment defaults. New-policy defaults apply only when
the backend explicitly reports no policy. Incomplete responses disable saving.
The opening duration initially reflects the remaining saved window; an expired
window requires entering a new duration explicitly.

A health refresh never supplies a new revision to old input values. A newer
policy produces a conflict and disables opening/pausing. A concurrent update
not yet polled is still rejected by the backend because POST includes the
original captured revision. Failed/uncertain saves require reloading too.

“Load latest settings” performs one authenticated read, replaces unsaved edits
and requires another explicit save after review. It never retries a write.
Successful saves adopt the acknowledged policy, while older polling responses
cannot roll it back or hide an observed conflict. Changing the connected admin
wallet or configured signer starts a separate edit session.

Pause uses the captured saved mode, watcher and service duration, ignoring any
unsaved form changes. It preserves a future expiry. The existing API requires
a future expiry even for a pause, so pausing an already-expired window records
a one-minute inactive expiry while keeping intake disabled.

No server behavior, watcher configuration or polling interval changes here.

## Verification

- `npm test`: saved nondefault policy, polled and unobserved conflicts, late
  success/old health responses, explicit reload, pause, wallet isolation,
  missing policy fields and expired windows.
- `npm run test:intake-policy`: compiled desktop/mobile UI against a disposable
  API/database. Verifies real HTTP 409 revision rejection, saved watcher/service
  preservation and pause semantics. Set `SAFFRON_BACKEND_SOURCE` to the isolated
  backend fixture and `MERGE_DIST` to the build. Private database connection
  settings are supplied by that fixture environment, not this repository.

The browser suite creates no quotes or wallet transactions.
