# Live APR deployment contract

The SPA mount and APR gateway mount are independent. Set
`VITE_LIVE_APR_API_BASE` to the existing same-origin gateway when building.
For example, an app under `/apps/merge/` can use `/api/live-apr/v2`.
Do not append an API suffix to the page URL unless that route actually exists.
The optional pre-module runtime override takes precedence over the build value.

Verify the compiled deployment without request interception or an API override:

1. Session admission must return HTTP 201 on the configured gateway.
2. The event stream and session renewal must return HTTP 200 there.
3. Require a new baseline, advancing block coverage, and fresh valuation.
4. Check independent comparison tiles, optional history and narrow layouts.

HTTP 401/403 indicate authentication failure; 404 indicates unavailable routing.
They must show an explicit service error, not an expired observation. This also
applies when an upstream proxy returns HTML instead of JSON. Genuine 409/410
expiry retains the existing refresh-to-resume behavior and does not create a
replacement admission. The 20-minute interest deadline is unchanged.

A real interval without swaps may show 0% APR. Missing valuation is unavailable,
not zero. UI fixtures verify rendering and failure states, not live collection.
