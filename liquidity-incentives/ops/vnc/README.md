# VNC-backed disposable vault testing

This committed harness runs the production UI, API, PostgreSQL, local Anvil
contracts, and generated wallets in a dedicated Chromium window. Each local
vault creation passes an exact factory fork simulation first. No mainnet RPC,
production database, or live signer configuration is loaded.

## Install and start

VNC **hosting requires Linux with systemd**. Windows can use `npm run demo` or
a browser to access an already hosted viewer. Native Windows hosting is absent.

Install Node 22.9+, PostgreSQL 16 server/client, TigerVNC (`Xtigervnc`), noVNC,
websockify, Python 3, GnuPG, and Playwright Chromium dependencies. From this
package run `npm ci`, `npx playwright install chromium`, and `npm run build`.
Commit the reviewed source before starting the launcher.

Review `config.mjs`. Defaults use dedicated ports, display `:92`, and
`/var/lib/saffron-vault-watcher-qa`. To override them, create an owner-only JSON
configuration outside Git and set `SAFFRON_QA_CONFIG` to its absolute path.
The defaults document every key. Set `publicOrigin` to the exact authenticated
HTTPS origin when publishing. Do not put credentials in this configuration.

As root, from `liquidity-incentives`:

```sh
bash ops/vnc/start-qa.sh --init
node ops/vnc/qa.mjs status
```

`--init` creates a missing dedicated Unix-socket-only cluster and a local test
role with CREATEDB. It never changes another cluster. Later starts can omit
`--init`; active services and their test are preserved. The fixture creates
random `saffron_incentives_test_<hex>` databases only.

The loopback page is `http://127.0.0.1:8933/`. Publish the wrapper and viewer
together using `nginx.example.conf`, inside a reviewed TLS virtual host with
authentication. Configure its auth file outside Git through host secret
management. Never publish raw RFB, DevTools, PostgreSQL, or the control socket.
Validate nginx separately before reloading. A viewer does not transfer custody.

## Controls

- **Refresh status** reads the current test; it does not reset it.
- **Reopen test browser** restores a window in the original wallet context.
- **Fund half / Fund premium** use a generated local funding wallet.
- **Advance to maturity** changes only the local chain and fixture clock.
- **Start fresh test** archives the old test, then starts an empty fixture.
  Repeated clicks for the same old session cannot reset its successor.

Local commands are `node ops/vnc/qa.mjs` followed by `status`, `fund-half`,
`fund`, `mature`, or `screenshot`.

Connect Uniswap Extension in the viewer, select a campaign, and pay the local
$2-equivalent fee. Follow C06 progress, fund the premium, deposit LP assets,
claim, advance time, and withdraw. Start fresh before new post-time-travel quotes.

## Backup, reset, and upgrade

Configure `archiveRecipientsFile` with a GnuPG recipient-ID file outside Git.
The host needs the decryption key to verify archives. Reset encrypts PostgreSQL,
local chain state, and local permits under `dataRoot/resets`. It reads every
archive member back before restarting. Archive failure leaves the test running.

**Wallet private keys remain memory-only.** Archives preserve evidence, not
those keys. Closing the viewer page preserves the test. Stopping the fixture
discards its wallets and drops its disposable DB. Do not restart a populated
test merely to inspect or refresh it.

Services are transient systemd units, not boot-enabled production services.
After reboot, the launcher starts a new fixture. For upgrades, archive the old
test, review changes, rebuild, and deliberately replace only affected QA units:
`postgres`, `display`, `vnc`, `browser`, and `web`, prefixed by `unitPrefix`.
Preserve PostgreSQL unless its configuration changes. The browser unit pins
its reviewed Git commit and uses a host-local static build copy; resetting cannot
silently adopt a different checkout. Use a separate config, data root, unit prefix,
display, and ports to stage an upgrade while preserving a populated old session.
Never restore an old spent live-signer permit as new authority.

## Maintenance

Run `npm run test:vnc` after wrapper, reset, or recovery changes. These tests
use synthetic responses and separate headless browsers; they never connect to
or reset the shared VNC session. Run package database, lifecycle, and browser
tests when fixtures change. Verify actual viewer interaction after host/proxy
changes. Keep screenshots, state, archives, credentials, and logs outside Git.
