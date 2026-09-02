# Server agent guide

This file applies to everything under `server/` and supplements the repository
root `AGENTS.md`.

## Purpose and trust boundary

- `proxy.mjs` is a zero-dependency production server. It serves the compiled
  `dist/` application and relays same-origin `POST /rpc/<chain>` requests to a
  configured upstream RPC endpoint.
- The relay exists to keep provider credentials out of browser bundles. Read
  RPC URLs from server-side environment variables or the ignored local `.env`;
  never return, log, embed, or commit them.
- Wallet approvals and transactions belong in the browser's injected wallet.
  This server must never hold a private key or sign, submit, simulate, trace,
  or administer transactions.

## Security invariants

- Keep the RPC method allowlist explicit and read-only. Do not add
  `eth_sendTransaction`, `eth_sendRawTransaction`, signing, account, wallet,
  debug, trace, miner, txpool, or admin methods without a dedicated security
  review.
- Validate every item in a JSON-RPC batch. A batch is allowed only when every
  call is structurally valid and its method is allowlisted.
- Never accept an upstream URL, arbitrary chain name, filesystem path, or
  request headers from the caller. Chain slugs must map only to operator-owned
  configuration.
- Preserve the request-body size limit, POST-only RPC behavior, and fail-closed
  responses for malformed JSON, unknown chains, and disallowed methods.
- Preserve the `resolve`/`relative` containment check for static files. Do not
  weaken path traversal protection or expose files outside `dist/`.
- Keep `BASE_PATH` handling consistent for both static assets and RPC routes.
- Preserve the one-request-per-connection behavior and `clientError` handling;
  they protect deployments behind intermediaries that can desynchronize HTTP
  framing.
- Return bounded generic errors. Do not expose upstream URLs, credentials,
  response headers, stack traces, or local paths.

## Implementation rules

- Keep the server on Node built-ins unless a dependency is clearly justified.
- Separate static serving, RPC validation, and upstream forwarding logic when
  extending the server so each boundary remains reviewable.
- Timeouts, cancellation, or rate limiting should fail closed and must not
  broaden the method or origin trust model.
- Keep production binding on loopback by default; public TLS and request limits
  belong at the reverse proxy described in `ops/README.md`.

## Verification

After server changes:

1. Run `npm ci` and `npm run build` from the repository root.
2. Start the server on an unused loopback port with test-safe RPC endpoints.
3. Confirm a static asset and the SPA fallback return successfully.
4. Confirm an allowlisted read such as `eth_chainId` is relayed.
5. Confirm a disallowed method, malformed JSON, non-POST RPC request, unknown
   chain, oversized body, and traversal attempt are rejected.
6. Scan the build and logs to ensure no RPC credential or upstream URL leaked.
