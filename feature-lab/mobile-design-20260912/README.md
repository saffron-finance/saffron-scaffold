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

The checked-in standalone HTML is a frozen design reference and needs no renderer
or installation. Its historical `build.py` remains as provenance; regeneration
is not part of the application build or source-handoff acceptance. It requires
an explicitly supplied external renderer with `scripts/render.py` and reads the
included frontend's licensed fonts/images. No private default path is assumed,
and that external renderer is not an application dependency.

The HTML can be shared alone. Funnel Display's font license is embedded in it
and retained in the frontend sources. Use the frontend's `scripts/render_install.py`
for the maintained installation guide; that renderer is self-contained.

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
