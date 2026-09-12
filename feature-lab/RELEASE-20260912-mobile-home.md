# Mobile Home — version 0.2.3

Implements the Home screen approved from the mobile design study and Joey's
12 September screenshot. The implementation is in the existing app, not an
iframe or a copy of the mockup's in-memory transaction handlers.

## Scope

- Below 600 CSS pixels: compact emblem/Connect header, short introduction and
  How it works disclosure, pair/network heading, APR-first offer cards, equal
  Duration/TVL typography and fixed Home/Portfolio/Live APR/More navigation.
- All three offer cards use the current catalog and existing modal handlers.
  The NEW label stays on the first eligible offer. Preview TVL remains
  $500,000 / $700,000 / $900,000; API mode does not invent live TVL.
- More opens the existing menu. Secondary destinations, source/installation
  links and preview controls remain reachable. Refresh offers is retained in
  How it works; saved-payment and checkout recovery remain visible.
- Phone Home uses the approved Funnel font and fixed card styling. Existing
  desktop appearance preferences remain saved without changing phone cards.
- Desktop and tablet at 600px and above, other destinations, incentive modals
  and the 15% modal hover treatment retain their existing layouts/behavior.
- No fake status bar, device frame, new backend state or wallet logic is added.
  Bottom padding and safe-area styles keep the last card above navigation.

## Checks and operating boundary

See `live-apr-merge/docs/verification-mobile-home-20260912.json` for results.
The 390px compiled cards are compared directly to the independent HTML concept,
excluding its decorative frame and OS status bar. Existing 600/800/1440px
geometry and fonts are compared to the backed-up 0.2.2 deployment in both
sidebar states. Browser checks include real touch emulation, route/More/focus
behavior, all three card modals, Back preservation and saved request reload.

The live build is compile-checked; this release does not activate an API
backend or send a transaction. The hosted app remains the existing lab preview
with read-only live APR and simulated incentive requests. No VNC session,
database, wallet, fork, service or APR collector was reset.

The published source ZIP and installation guide are refreshed with the release.
Assets are published before index.html; old hashed assets are retained for
open tabs. Deployment hashes are checked independently after publication.
The existing authentication and route configuration are unchanged.

Operator-local backup and validation directory:
`saff/feature-lab/live-apr-merge-work/mobile-home-20260912/`.
It includes a verified Git bundle, the previous static files and hashes, route
configuration copy, build/browser logs and desktop comparison evidence.

Published page:
https://clawbee.xyz/saffron/apps/feature-lab/live-apr-merge/
