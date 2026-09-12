# Live APR gateway acceptance

The frontend consumes the existing v2 gateway. It does not deploy a collector or
create a second APR backend. Gateway availability is independent of incentives
checkout, vault funding and position ownership checks.

## Route and session contract

Configuration precedence is runtime `window.__SAFFRON_LIVE_APR__.apiBase`, then
build-time `VITE_LIVE_APR_API_BASE`, then the mounted app's
`api/live-apr/v2` route. Use a same-origin route to retain browser session cookies;
service credentials belong at the hosting/gateway boundary, never in a public
build setting. Preserve `X-Session-ID`, cookies, Origin and unbuffered SSE through
the reverse proxy. Hosting access does not confer application operator permission.

Each document/pool entry owns one idempotent load ID. Admission retries keep that
ID. Resume, history, presence renewals and stream reconnections reuse the receipt
and its accounting baseline. An unknown receipt pauses for explicit refresh;
it never silently makes a new admission. A route exit aborts streams and releases
presence. Background/bfcache suspension retains identity for resume.

Transport or gateway failures show **APR unavailable**. Retained observations
are labelled stale and their display interpolation stops until recovery. A pool
valuation failure keeps its specific unavailable reason. Wall-clock presence and
SSE heartbeats never stand in for committed chain time, prices or Q36 returns.
The Live APR route remains visible, and independently ready vault actions remain
usable during an APR-only outage.

## Reproducible checks

- `npm test` covers session admission/resume, stream framing, history bounds,
  stale sequences, epochs/database generations, Q36/chain-time projection,
  initial display-only zero, comparison ownership and clipboard failures.
- After `npm run build:live`, `npm run test:apr-http` uses a controlled HTTP/SSE
  gateway contract fixture with real browser networking. It checks a lost admission
  response, two-pool comparison, cookies and session headers, history, bfcache
  resume, outage recovery, failed resume and release. It does not replace browser
  fetch or EventSource with an in-page mock.
- `npm run test:backend-browser` keeps APR unavailable while a real disposable
  incentives API completes fee payment, creation, funding, entry and withdrawal.
- The compiled preview checks exercise actual PNG pixels with test-granted
  permissions. Unit tests cover denied/unavailable clipboard APIs. Neither result
  qualifies actual phone or deployed HTTPS clipboard permissions.

HTTP contract evidence is written to `validation/apr-http/verification.json`,
explicitly labelled `controlled-http-contract` and `liveGatewayQualified:false`.
These checks establish client/protocol behavior, not the deployed gateway's
availability or chain ingestion.

## Launch qualification still required

Record the intended gateway owner, endpoint, mounted proxy route and API version
in the protected operating record. Through the hosting provider's existing staging
access, verify two-pool comparison, one admission per pool, authenticated stream
headers, unbuffered heartbeats, preserved receipt/baseline across reconnect and
history, and clean route teardown. Confirm actual committed chain freshness.

Run the served-release browser check against that deployment and record its build
identity separately from these fixtures. Test PNG copy under normal HTTPS/browser
permissions and the selected real wallet browsers. Actual gateway, hosting and
device evidence remains a launch gate; controlled fixtures alone do not qualify
those services and devices.
