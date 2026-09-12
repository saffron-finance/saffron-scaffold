# Live APR aggregate frontend

The existing pool catalog, URL slugs, page styles and navigation are unchanged.
The page no longer imports or retains the legacy raw-swap `Map` ledger. The migration excludes that
legacy module; the mounted UI uses the version-2 cumulative contract.

## Portable mounting

- `VITE_BASE_PATH` configures this package's Vite/router mount.
- `VITE_LIVE_APR_API_BASE` optionally supplies the aggregate API mount.
- At runtime, `window.__SAFFRON_LIVE_APR__.apiBase` overrides the build value.
- Without an override the API defaults to `<BASE_URL>/api/live-apr/v2`.
- Use a same-origin proxy to preserve the existing authentication boundary;
  there is no required domain name, DNS vendor, VPS path or provider endpoint in
  the application modules. Browser requests never contain the QuickNode key.

## Ownership and clocks

`summary-client.ts` owns one immutable `loadId` per actual document/pool-route
entry. React StrictMode reuses that controller, and deferred final cleanup
prevents a synthetic remount from releasing or re-admitting it. A route exit
aborts transport and releases the old session. A persisted `pagehide` closes
transport without ending the load receipt; `pageshow` resumes the existing
receipt. Failed/unknown recovery pauses and requires a real user refresh.

The client uses `/sessions` only for that entry's idempotent first admission;
all established-session recovery uses `/sessions/resume`. The SSE stream uses
`X-Session-ID` plus same-origin authentication. Presence renewal acknowledges
the separate baseline control every 27–30 seconds, but never calls admission or
alters the paid-interest clock. No event handler for focus, history, Tokens
search, heartbeat or reconnect creates a new load.

`summary-session.ts` subtracts integer Q36 cumulative totals before converting
the resulting display amounts. APR uses differences in committed chain time,
not the page timer. It rejects stale sequences, old epochs and unannounced
database generations. The independent tab baseline also lives in
`sessionStorage`, namespaced by the load ID; a full refresh deliberately gets a
new ID and cannot reuse its previous observation.

The last coherent financial result is a separate immutable object. At the
server-owned pool deadline or intentional pause it stays unchanged, including
quote valuation time and the last watched swap block. The page timer remains
local. A new epoch retains those previous results until the new verified
boundary is available, then visibly starts a new observation. The current-block
row reports the last verified scan block represented by the displayed observation.

Named heartbeat events prove transport only. Disconnection is displayed after
more than 20 seconds of continuous failure. Chain freshness is labeled
separately after 30 seconds. Transport failure displays APR unavailable with
retained observations labelled stale. Temporary control-plane failure freezes financial
values without treating an open socket as fresh blockchain data.

## Bounded transport and optional history

The vendored MIT `eventsource-parser` 3.0.6 handles WHATWG SSE framing. The
wrapper incrementally decodes UTF-8, limits incomplete frames to 16 KiB and
accepted event payloads to 8 KiB, and uses AbortController cancellation and
bounded reconnect backoff. Unknown framing extensions follow parser semantics;
invalid financial schemas leave the last valid snapshot intact.

History starts collapsed and therefore makes no requests. Expanding requests
at most 20 retained rows, validates the epoch and excludes pre-baseline blocks.
Newest-page refresh is limited to once per 30 seconds; collapse, route changes
and new epochs abort pending history work. A retained-range notice explains
that expired table rows do not reduce cumulative observation totals.

## Verification

Run `npm test` and `npm run typecheck` from this frontend package. After
`npm run build:live`, run `npm run test:apr-http` for real browser HTTP/SSE
transport against a controlled gateway contract fixture. After `build:lab`, the
compiled wallet/API suite is `npm run test:browser` with a disposable backend and a root
build mount. It checks layouts, wire contracts and real PNG pixels.

The bounded session/reducer tests are included in the normal suite. No monorepo
Yarn command, separate staging script or inherited fuzz configuration is required
or provided by this standalone package. See
[APR gateway acceptance](../../docs/APR-ACCEPTANCE.md) for the maintained checks
and the separate deployed-gateway qualification gate.

## Shareable pool comparisons

The page path selects the base pool. Repeated `compare` query parameters select
additional catalog pool IDs in display order, for example:

`/live-apr/swole-hood-1?compare=zzz-eth-1&compare=cashcat-eth-1`

Adding/removing tiles updates the URL in place without resetting existing
observations. Opening or refreshing the link restores the pool selection with
fresh independent observations. Unknown IDs and duplicates are ignored. Other
query parameters are preserved. Multi-pool views start with lower details
collapsed; collapse state and observation/session credentials are not shared.

Each page displays at most four pools including the base. Only the first three
valid unique comparisons are restored; Add buttons disable at capacity, and
removing a comparison frees a slot. This is a page limit, not an IP or tab limit.

## Fast initial APR display

APR keeps its loading placeholder for at least three seconds after opening a
pool. Existing TVL (even without a USD quote) or swap data can then seed a
display-only 0%, labeled "Waiting for swaps" until this page counts its first
swap (including when an empty interval already supports measured zero APR).
After a swap the caption becomes "Estimated LP fee yield". Without either signal, it keeps
waiting rather than inventing data. A positive verified chain-time interval
immediately supports measured APR; the old 30-second gate is removed. The
initial zero is not an accounting baseline or a claim of measured zero yield.
Short windows can produce volatile annualized values. Polling, requests and
onchain accounting are unchanged; paused displays remain frozen.
