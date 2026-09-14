# Download failure containment

The animated emblem is optional. A rejected JavaScript import or renderer
failure is caught inside the logo, leaving its still image mounted. Model and
texture errors use the same static state. If the still also fails, an inline
lettermark needs no additional download. No failure triggers an automatic reload.

The optional appearance editor has its own boundary. APR failures stay inside
the existing section boundary, so navigation remains available. The outer root
boundary catches unexpected shell/render/effect failures, outside the router and
theme. Its plain recovery screen preserves storage and offers explicit Reload
and Home actions. It does not retry a wallet write or assume a pending transfer
failed. If even the initial JavaScript download fails, static HTML retains a
connection/reload message before React can run.

PNG capture and WalletConnect imports retain their existing promise error
handling. Tests cover the connector import and nested AppKit core/basic/modal
downloads, showing a connection error with a usable close control. An explicit
retry is permitted, but the browser may cache failed module loads until reload.
No automatic cache-busting imports, polling or write retries are introduced.

## Repeat the download checks

From this frontend package, after installing dependencies and Playwright Chromium:

```bash
npm test
npm run test:downloads
```

`test:downloads` first builds a **non-deployable** isolated fixture in
`validation/downloads-build` without a release marker. The application, logo,
APR, PNG and QR UI modules are real; only the WalletConnect peer is replaced
with the existing deterministic test peer. The browser server binds to localhost
on an ephemeral port, blocks external traffic and does not use any backend,
database or signing key. Synthetic read-only APR messages stay in memory.

The suite exercises healthy desktop/mobile rendering, failed/corrupt logo JS,
each model/texture, a missing still, optional editor failures, simultaneous
optional failures, APR JS/CSS, PNG capture JS, four wallet download layers,
images/fonts, entry CSS/JS, and an unexpected shell effect failure. It checks
that actual targeted downloads occurred, saved storage survives, the appropriate
fallback appears, unaffected controls remain usable, and no API mutation is sent.
Results/screenshots go to `validation/downloads`, not Git.

This is fault injection, not evidence of a production asset outage. It tests
the app-owned lazy entry points and representative nested SDK assets, not every
third-party icon, CDN response, browser extension or possible network failure.
Error boundaries cover render/effect/import rejection, not arbitrary detached
promises or JavaScript that never executes. Async actions still own their catches;
initial-bundle recovery is the separate static HTML fallback.
