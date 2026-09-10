# Independent incentives application: operator runbook

## Services and trust boundaries

Operate this package's built UI, Node HTTP API/observer, PostgreSQL database and
separate scaffold worker. External services are the configured Robinhood RPC and
explicit USD pricing provider. The package owns its application services, wallet
sessions and database.

The supported chain is **4663** and the unrestricted factory is
**0xCe97eE64AD415976c465A783725014e67832BE1A**. Full-range creation follows the user's
signed authorization. There is no admin creation form or request fee. An allowlisted
operator separately authorizes premium funding.

HTTP handlers authenticate and record durable jobs, then perform chain reads only.
The separate worker owns the signer and executes creation, approved funding,
retirement and fee collection. User LP actions go directly through the connected
wallet. The public read-only RPC relay cannot sign or broadcast.

## Fresh installation

1. Install Node 22.9+ and run `npm ci` and `npm run build`.
2. Provision an empty dedicated PostgreSQL database/application role and a separate
   worker host/database role with access to the same application schema. Startup
   installs `server/incentives.sql` under a schema lock. No historical data import
   is needed. Production roles do not need CREATEDB; disposable test roles do.
3. Configure the API from `.env.example`: `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`,
   `PGDATABASE`, `RPC_ROBINHOOD`, `PRICE_API_ROOT`, `SAFFRON_PROTOCOL_CONFIG`,
   `SAFFRON_ADMIN_WALLETS` and `SAFFRON_APP_ORIGIN`. Use local sockets or a protected
   private database connection. Restrict database/backups: the execution journal
   contains signed transaction bytes.
4. Copy `protocol.example.json` to an operator-owned location. Set the worker's
   public address, reviewed type IDs/code hashes, confirmations and per-vault
   premium ceiling. These values must match the worker. The API protocol file
   contains no credential path, signer secret, RPC URL or database password.
5. Start `npm run serve` on loopback (default `127.0.0.1:3201`). Put TLS and per-client
   limits at a trusted reverse proxy. Preserve Cookie, Set-Cookie, Origin and
   X-Saffron-CSRF. Never cache `/api/incentives`. Sessions use HttpOnly,
   SameSite=Strict cookies (Secure on HTTPS), last 30 minutes, and require renewed
   sign-in after API restart. Accepted intents remain durable in PostgreSQL.
6. Set the exact browser origin, without a path, in `SAFFRON_APP_ORIGIN`. For a mount,
   build with `VITE_BASE_PATH=/incentives/` and serve with `BASE_PATH=/incentives`.
   Preserve that prefix for static assets, SPA routes, API, prices and RPC.
7. Provision/inspect the worker below. Creation gas, premium assets and spend limits
   require explicit operator setup before activation.
8. In `/admin`, sign in with an allowlisted wallet, load **Programs and campaign
   budgets**, and add the chain-verified pair, campaign allocation and linked
   programs. Production begins empty; activate rows when the campaign is ready.

The initial release supports EOA signatures. EIP-712 authorizes the application
worker, not an onchain permit. The domain binds chain/origin; the payload binds
wallet, program, unique quote, factory, exact plan, principal and premium.

### Pricing and wallet network configuration

The API reads `PRICE_API_ROOT/<quote-token-address>/price?symbol=<symbol>`. The
provider must return this shape, with a current timestamp and the requested address:

```json
{"success":true,"data":{"chainId":4663,"tokenAddress":"0x...","currency":"usd","price":2000,"timestamp":"2026-09-09T00:00:00.000Z"}}
```

Price must be positive and at most 60 seconds old/five seconds in the future.
The shown timestamp is only an example. Reward-token USD price derives from the
verified pool price and quote-token USD price. Addresses/decimals, rather than
symbols, govern sizing. The worker uses the frozen accepted plan and has no
pricing-provider dependency.

The browser uses same-origin read RPCs. Never set credentialed `VITE_RPC_*` values.
Optional `VITE_WALLET_RPC_ROBINHOOD` is an explicitly public URL for wallet add-chain;
otherwise configure Robinhood in the wallet. Provider error diagnostics are
sanitized before returning them to a browser.

## Protected signer

Use a dedicated worker EOA for creation, gas and initial premium funding; do not
use it in another concurrent transaction sender. Provision its key through the
host's masked secret entry/encrypted store. Never put keys in chat, arguments,
environment variables, source, config JSON or the HTTP process. If protected
injection is unavailable, provision externally on a supported host.

`saffron-vault-creator.service` uses systemd `LoadCredentialEncrypted`. The decrypted
file is owner-only/read-only and inaccessible to the HTTP service user. The worker
validates owner-only file permissions and the configured public signer address.
The included service unit supplies the protected credential to the worker.

Use an operator-owned copy of disabled `creator.example.json`. Set RPC/database
configuration, reviewed type IDs/hashes, limits and the credential-file reference.
Inspect without signing:

```sh
npm run worker:inspect -- "<worker-config-file>"
```

Compare the public hashes with reviewed contract artifacts through an independent
trusted source. Prefilled hashes record the prior read-only inspection of factory,
vault type 1 and full-range adapter type 2 at block `0x37d621f`; reinspect before
activation. They do not establish live creation/funding.

- `maxGasPerTx` and `maxGasPriceWei` bound every signed transaction.
- `maxDailyGasWei` bounds signed worst-case gas costs over a rolling 24 hours plus
  unresolved older transactions. This conservative limit is not actual gas spent.
- `maxPremiumRaw` is a per-vault raw-token ceiling matching the API configuration.
  Campaign budgets separately bound cumulative commitments across programs.
- `confirmations` must be at least two, configured consistently in API and worker.

After separately provisioning native gas and reward assets, set `enabled: true`
and install/start the included service, or run:

```sh
npm run worker -- "<worker-config-file>"
```

`--once` processes one eligible job for an external supervisor. Normal mode polls
continuously. No additional agent or LLM deployment service is needed. Never
activate a live signer merely to run tests.

## Operations and accounting

Acceptance atomically commits an immutable intent, reservation, ledger entry and
job. The worker records signed bytes before broadcast and resumes **create adapter
→ create vault → initialize**, checking factory/types/creator/events and canonical
receipts. Initialization leaves the profile Awaiting admin funding.

Review the commitment and **Approve premium funding**. The worker deposits only
remaining variable capacity within that authorization. Partial funding/direct token
transfers cannot expose Deposit. The user then approves the verified adapter,
wraps ETH if needed, deposits side 0, claims and withdraws in the shared modal.
Public users have no variable-side entry.

`available = limit − reserved − allocated`. Funding moves reserved to allocated.
Claims and maturity leave spending allocated. Allocation increases are explicit
revisioned operator edits; decreases cannot go below committed spending. Programs
sharing a campaign lock and consume the same chain/reward-token budget.

Administration exposes heartbeat/gas, pending and 24-hour attention counts, funding
shortfalls and transaction journals. Budget controls show reserved/allocated/available
premium and reconciliation flags. Monitor these plus service supervisors for stale
RPC, offline services, exhausted gas/capacity and growing retries. Logs exclude
credentials and raw signed bytes.

## Timeouts

| Condition | Behavior |
| --- | --- |
| Wallet challenge | Five minutes, one use, exact wallet/origin/chain |
| Wallet session | 30 minutes; renew after expiry/restart |
| Quote | At most two minutes; never beyond the price's 60-second freshness window |
| Unsigned reservation | 15 minutes; release only without any signed transaction or active lease |
| Worker lease | 60 seconds, renewed; advisory signer lock serializes workers |
| Retry | Five-second to five-minute backoff; unrelated jobs continue |
| Attention | Pending over 24 hours; no automatic release of signed work |
| Readiness | Snapshot at most 15 seconds old, head at most 60 seconds old, canonical confirmations |
| Signed transaction | No timeout proves failure; retain until canonical outcome is known |

## Recovery and reconciliation

- **Unsigned cancellation:** users can cancel before any worker transaction is
  signed, once an active lease resolves. Release/retirement are atomic; replaying
  the authorization still returns the same retired intent.
- **Interrupted work:** restart with the same database, signer and config. The
  worker reconciles or rebroadcasts exact saved bytes. A consumed nonce with an
  unknown outcome stays unresolved. Never delete journal rows to force a retry.
- **External replacement:** choose a saved transaction in the journal and submit
  its confirmed replacement hash. It must have the same signer/nonce and exact
  action, or be a successful empty-data, zero-value self-transfer. That self-transfer
  consumes/cancels the nonce without deploying or funding. After a proven
  cancellation/revert, **Resume saved operation** authorizes a retry. The app
  does not create cancellation transactions itself.
- **Browser response loss:** resume the exact locally saved authorization/action
  after reload. Supply the existing/replacement hash to **Check transaction** when
  needed. An unrelated replacement cannot clear it. A lost HTTP/wallet response
  does not justify another signature or transaction.
- **Pre-start fixed recovery:** current claim-token owners can recover LP assets
  from an unstarted vault. The premium stays reserved until retirement. Transferring
  away claim/bearer tokens removes the sender's action rights; zero balances alone
  never mark the position Completed.
- **Received positions:** the observer follows claim/fixed-bearer transfers for
  application vaults, retaining a canonical scan checkpoint. Recipients can claim,
  recover or withdraw in their own profile; request management remains with the
  original requester. Discovery scans up to four 2,000-block ranges per vault per
  poll and shows a checking notice while catching up. Balance reads independently
  verify ownership before exposing actions. A changed checkpoint hash restarts
  discovery from the canonical creation receipt, or genesis if it is unavailable.
- **Retirement:** **Recover unused funding and retire** first resolves every known
  signed outcome. The vault must be unstarted, without a fixed claim, and the worker
  must own all variable bearers before it can recover premium. Only canonical
  empty-vault evidence releases the commitment. External bearer owners must
  separately recover or return their tokens; the app cannot seize them.
- **Maturity:** fixed withdrawal settles the protocol position as needed. An operator
  separately collects variable-side fees. Spent premium does not become available.
- **Reorganization:** a noncanonical release proof freezes admission. Reconcile the
  budget to restore the obligation, then repeat retirement on the canonical chain.
  If available capacity is insufficient, explicitly increase the budget first.
  Reconciliation leaves the campaign paused for operator review before unpausing.
- **Ledger drift:** mismatched ledger/reservation/cache totals close admission.
  Reconcile cannot erase a real mismatch. Inspect/repair accounting evidence under
  operator control, then audit again.

The unrestricted contracts do not reserve a fixed slot for the authorizing wallet
and do permit underfunded fixed entry. Fresh reads and wallet simulation reduce
funding/entry races; native pre-start recovery handles an unstarted confirmed
LP deposit. This is a boundary of the common onchain product.

## Pause, rollback and independent release

Pause a program/pair to stop new acceptance for the offer. Pause a campaign budget
to stop new creation steps/funding across its programs while retaining commitments
and recovery. Retirement remains allowed while paused unless reconciliation is
required. Stop the worker for a service pause; preserve its database and credential.

Run the README checks, review the release, and deploy this package's UI/API/worker
and matching config together. Verify the catalog and operator status before admitting
a campaign. Independent CI validates this package without publishing or signer
activation. Production remains an operator-owned release process here.

Back up the database and protected config. Roll back binaries/configuration while
retaining newly signed transactions and ledger evidence. Reconcile any restored
database against chain nonces before restarting its signer. Never replace unresolved
work with a clean queue. Implementation tests performed no live signing, funding
or deployment; those require operator activation.
