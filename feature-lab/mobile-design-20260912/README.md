# Saffron mobile design study — 12 September 2026

Open `saffron-mobile-design-2026-09-12.html` in a modern browser. It is the
complete standalone deliverable, including embedded fonts, images and thirteen
interactive HTML mockups. No installation, wallet or network is needed.

## Scope

This is a proposed mobile design, not an implemented mobile app release.
Payments, request state, APR values and vault actions inside the mockups are
illustrative and remain in memory. The mockup reset cannot affect any real app,
database or VNC environment. The separate live-frontend change raises enabled
modal-button mouse hover to `brightness(1.15)` in version 0.2.2.

## Editable sources and rebuild

- `build.py`: full report content, iframe assembly and embedded assets.
- `report.css`: Saffron-themed report layout, responsive and print styles.
- `app.html`, `app.css`, `app.js`: isolated, interactive phone prototype.
- `assets/current-home-390.png`: current-layout reference captured by the
  compiled frontend browser check; this is not a proposed mockup.
- `verification.json`: the recorded browser, offline and print checks.

The builder uses font/image files in the sibling `live-apr-merge` source tree
and the Clawbee reports renderer. Pass the installed skill directory explicitly
if it is not at the default workspace location:

```sh
python3 build.py /path/to/clawbee-reports
```

This writes the complete HTML and an ignored intermediate `report.json`.
The HTML can be copied or shared alone. Funnel Display's font license is
embedded in the HTML and retained in the app source.

## Verification

With the sibling frontend's documented Node dependencies and Playwright
Chromium installed, run from this directory:

```sh
node verify.mjs
```

The verifier serves the exact HTML on an ephemeral loopback port. It blocks
unexpected network access and exercises the request/recovery/LP flow,
navigation, keyboard-space simulation, narrow viewports, disclosures, deep
links and print-state restoration. Screenshots, a print PDF and results are
written to the ignored `validation/` directory.

Real iOS/Android devices, OS keyboards and wallet interoperability remain
implementation acceptance gates, not claims made by this prototype.
