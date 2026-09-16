# Refresh and return-visit loading

The entry document, fonts, application modules, and API data have separate
lifetimes. Caching the catalog alone cannot fix late font discovery or repeated
script transfers.

## What changed

- HTML declares the shared font stylesheet and preloads the three local variable
  WOFF2 faces. Vite gives preload and CSS references the same fingerprinted URL.
  Early non-blocking FontFaceSet activation also starts decoding before the
  first React text. The ordinary application does not await fonts; the optional
  warm display gives cached faces at most 150 ms to finish decoding, otherwise
  it uses the ordinary startup. No third-party font request is required.
- Appearance presets keep their existing saved IDs, weights and behavior but use
  those shared font families. Five duplicate TTF files and their late `@font-face`
  injection are removed. The unused Work Sans declaration is removed too.
- Appearance styles are available in the first React render, instead of arriving
  in a separate late chunk. Non-lab builds still compile the editor to a stub.
- Portfolio, Campaigns, Administration, Status, Journey Guide, and vault dialogs
  load on demand. Their loading boundaries preserve the application shell and
  keep a pending dialog download from hiding its opener. APR and WalletConnect
  retain their existing demand-loaded boundaries. Used 3D artwork is retained.
- Header and offer chain artwork now share the same fingerprinted SVG URL.
- Homepage no longer polls wallet portfolio/session/payment-history resources.
  Portfolio starts those reads when entered; disabled consumers register no
  polling timers or resume listeners. Checkout recovery remains unchanged.
- The display-only offer snapshot now uses app-path-namespaced localStorage, not
  tab-only sessionStorage, with a five-minute lifetime. It can paint a return
  visit in a new tab. Size, age, top-level and nested display fields are checked;
  invalid/expired/future/blocked storage follows the normal cold path. Successful
  empty responses replace old offers. An unsuccessful refresh does not renew
  the timestamp, keeps existing rows, shows the error and keeps actions disabled.
  Cached availability never authorizes a transaction: fresh catalog success is
  required. No wallet, payment, authentication or readiness snapshot is added.

## Warm first-screen path

A cached download still needs JavaScript execution, React rendering, CSS
processing and layout. The warm path now separates display from initialization:

1. A small bootstrap reads the same validated five-minute display snapshot.
   It applies only to Home, not APR, portfolio, checkout or operator routes.
2. The build generates inert shell/group/row templates from `AppShell`,
   `HomeCatalog`, `OfferGroup` and `OfferRow`, the same components used by React.
   Templates contain placeholder data only. Browser storage never supplies HTML,
   CSS or arbitrary image URLs; text is assigned with `textContent`, and token
   artwork uses the shared local allowlist.
3. Cached fonts and saved appearance preferences are ready before exposing the
   warm view. Buttons are disabled and the temporary root is inert. Empty
   snapshots are valid; malformed, expired, oversized, future-dated and cleared
   storage retains the ordinary skeleton and application startup.
4. The bootstrap yields a rendering opportunity, then imports the main app.
   React replaces the view in one commit; template CSS is removed after live
   styles exist. Wallet/session/payment recovery and authoritative data remain
   in the application, never in the display snapshot. An import failure leaves
   the saved rows visible with an explicit reload action.
5. Stable sidebar, pair-header and offer-row CSS is compiled into the cached
   stylesheet. The appearance editor mounts and downloads only when opened;
   its small validated preference/style layer remains eager, so opening the
   editor cannot introduce a second font/style change.

The build-only server renderer adds no browser runtime dependency. `esbuild`
compiles the presentation template at build time; emitted asset placeholders
resolve to the same Vite fingerprints used by the application.

Back/Forward cache is separate from HTTP caching. On `pagehide`, catalog action
permission is synchronously revoked and expendable reads are cancelled. A
persisted `pageshow` retains visible rows but starts one new availability check.
Late pre-freeze replies cannot overwrite restored-page results. Wallet and API
checks still gate actions; restored pixels are not restored authority.

Measure row **paint** separately from DOM insertion, FCP and application-ready
marks. `saffron:warm-display` and `saffron:app-ready` identify the two stages;
Element Timing on the duration text identifies rendered rows. Report refresh,
full URL return, new-tab return and true Back restoration separately. Browser
restoration eligibility is not guaranteed: when unavailable, the warm startup
path still works. No service worker or cache-clear recovery was introduced.

## Hosting requirements

The host must preserve authentication for every static route. Recommended HTTP
policies (the deployed host was independently verified):

- Fingerprinted `/assets/` files: `Cache-Control: private, max-age=31536000,
  immutable`. Serve them directly as static files with ETag/Last-Modified support.
  Their URL changes whenever their contents change. Retain older fingerprinted
  chunks during a rollout so already-open tabs can finish navigating.
- Stable-name artwork: `private, max-age=3600` plus validators. Do not use an
  immutable policy for files whose contents can change at an unchanged URL.
- HTML/release metadata: revalidate; do not pin users to an old entry document.
- API/RPC/session/payment data: retain the original no-store policy. Do not place
  authenticated responses into a shared proxy cache.
- Enable gzip for JS, CSS, JSON, and SVG, not just HTML. WOFF2 and raster images
  are already compressed. A service worker is unnecessary for this design.

## Network dependencies and boundaries

The home catalog GET revalidates in the background and continues the existing
30-second visible-page cadence. A cold page needs that response for real offer
rows; a fresh display snapshot avoids waiting for it. Price/RPC reads start when
opening a relevant vault. Portfolio reads require a connected account. Operator
screens authenticate independently. APR opens its own read-only observation
sessions/streams on that route and releases them on exit; cached APR numbers
must never masquerade as a fresh observation. QR-wallet SDK work begins only
when needed by that connector or an existing session restoration.

Clearing site data or normal browser eviction discards caches. Hard reloads,
DevTools “Disable cache,” and private browsing can intentionally bypass them.
There is no cache-clear survival mechanism, offline transaction mode, duplicate
storage mirror, or new polling loop.

## Verification

- Hold entry JavaScript to inspect static layout; separately hold catalog GET to
  inspect the application shell and cold row placeholders.
- After seeding storage, hold the next GET through refresh/new-tab return. Rows
  must render before the response, with availability-sensitive actions disabled.
- Fail/recover that refresh; test malformed/expired/future/empty/blocked storage.
- Traverse and reload Home, Portfolio, Campaigns, Administration, Status,
  Journey Guide, Stats, Community, and Live APR at desktop and phone widths.
- Measure real HTTP caching without Playwright routing. Playwright HTTP-auth
  handling also sets Chromium cacheDisabled internally: use an already-authenticated
  profile or an audited same-origin authorization header without Fetch
  interception. Merely resetting cacheDisabled was insufficient in Chromium.
  Header assertions alone do not prove cached responses.
- Verify both anonymous 401s and authenticated 200s; verify 304s for validators,
  missing-asset 404s, compression, and unchanged API cache policy.

The source-graph review found all application modules reachable. Remaining
non-page shared modules belong to the pinned backend compatibility/source
handoff inventory and are not automatically downloaded. They were preserved;
this is not a backend/protocol audit or a claim of exhaustive transaction testing.
