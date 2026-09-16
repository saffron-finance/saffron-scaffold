# Refresh and return-visit loading

The entry document, fonts, application modules, and API data have separate
lifetimes. Caching the catalog alone cannot fix late font discovery or repeated
script transfers.

## What changed

- HTML declares the shared font stylesheet and preloads the three local variable
  WOFF2 faces. Vite gives preload and CSS references the same fingerprinted URL.
  Early non-blocking FontFaceSet activation also starts decoding before the
  first React text; the application does not await fonts. No Google Fonts connection or other third-party font request is required.
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
