# UI JavaScript performance maintenance

This review covers the browser-owned entry points, components, hooks, shared
styles and pinned presentation modules. It is not a backend or protocol audit.
Shorter source is not itself a speed improvement: Vite already minifies output.
Remove unused imports, repeated work and redundant renders first. Keep comments,
accessible interactions, financial precision and recovery checks readable.

## Changes

- `adapters/wallet/uiActions.ts` binds only the viem actions actually used by the
  interface. The implementations still come from viem; ABI types, chain/account
  checks, receipt tracking, transaction errors and transport settings remain.
  **When adding a wallet/RPC call, extend this allowlist and its compatibility
  tests rather than importing the complete public/wallet action decorators.**
  Never remove provider/preflight checks, alter retries or bypass recovery for
  bundle-size savings.
- `host/ui.ts` exports only shared eager primitives. Lazy modal-only form styles
  and the interactive emblem import their source directly. Unused table/card
  exports no longer cause startup work. Pinned vendor source remains available
  for provenance; unused modules are not shipped in the application graph.
- Sidebar rendering is memoized with a stable toggle handler. Router context,
  collapse state and the tooltip still update; header dialogs do not redraw the
  unchanged rail. Tooltip position belongs to its DOM ref, avoiding a second
  React render before paint. The first mouse-hover fade remains 220 ms.
- APR capacity-tooltip pointer movement changes only its portal's presentation,
  not React state for all menu rows. React owns portal lifetime; filtering,
  closing, scrolling and freeing a comparison slot dismiss stale feedback.
  Mapped pool destinations are reused until the host base path changes.
- APR number/currency formatters are reused by precision instead of reconstructed
  on every tile/history render. Dust, unavailable values, truncation and numeric
  inputs are unchanged; formatters are display-only, never transaction math.
- Summary-client notifications skip identity-equal patches. The lease timer,
  silent-stream recovery and exact expiration boundary still run. The shared
  display clock still updates elapsed time and APR; no server polling changes.
- Home and early cached display share `groupOffers`: one ordered pass instead of
  scanning the whole catalog for every pair. React memoizes the result by offer
  array identity. Existing warm/live consistency comments remain mandatory.

## Reviewed and deliberately retained

- Bounded catalog cache, disabled warm controls, early fonts and canonical
  build-generated markup; no new storage, offline mode or service worker.
- Lazy appearance controls and synchronous validated preference application.
  Their small writes happen on preference changes; debouncing can lose the last
  edit during navigation and was not justified by measurements.
- Portfolio/checkout/operator state machines, pending-payment restoration,
  cancellation checks, account/network validation and live-action authority.
- APR session identities, server deadlines, exact ledgers, reconnection,
  pagination/history cancellation, unavailable/stale/paused distinctions.
- Debounced token-address lookup and filter keyboard/pointer/touch behavior.
- Deferred 3D logo, reduced-motion handling, visibility suspension and disposal.
  Do not call removing an approved animation an optimization without explaining
  the visual change. Software-rendered headless animation timing is noisy.
- Existing route-level lazy loading, image-copy lazy loading, modal focus traps,
  Escape handling, external-wallet overlay behavior and error boundaries.

## Measurement rules

Measure the same build mode, viewport and throttling. Separate actual first-row
paint, FCP, React-ready time, API response latency and user-input-to-next-paint.
A smaller cached script saves parse/evaluation work, not another network trip.
Keep first open (lazy download) separate from repeated interactions. Event Timing
is quantized; unreported sub-16-ms events are not zero. Synthetic APR fixtures
isolate rendering; they do not measure upstream RPC or server response time.

No browser request interception belongs in HTTP-cache performance measurements.
Park other test documents so their animations cannot compete for the main CPU.
Compare normal animation and reduced-motion runs separately; never present a
reduced-motion result as a normal animated-page measurement. Report sample count,
median and tail, and retain slow samples. Verify warm/live geometry and tooltip
semantics after changes; measure runtime output, not only source character count.
