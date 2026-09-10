# Native vault lifecycle: operator setup

## What is shipped

The request UI, admin queue, profile, fixed-only deposit controller, session-authenticated
API, PostgreSQL jobs/readiness sidecars, and separate local creator/funder are implemented.
The worker uses chain **4663** and only unrestricted factory
**0xCe97eE64AD415976c465A783725014e67832BE1A**. No legacy app routes remain.
`creator.example.json` is deliberately disabled and contains no credentials.

## Bring up a reviewable candidate

1. Back up the existing database and restore a copy for first deployment. Do not
   run fixtures on it: tests create/drop their own unpredictable `liqifi_test_*` databases.
2. Point the candidate API at the copy using `SAFFRON_DB_HOST`, `SAFFRON_DB_USER`,
   `SAFFRON_DB_NAME`. Choose `SAFFRON_DB_SCHEMA_MODE=fixed-income` only if its pending
   table already exists; otherwise use `standalone`. Startup installs feature sidecars.
3. Inspect Maze's narrow `vault-sizing.sql` repair on the copy. It may repair only
   untouched pending catalog-sized projections; original receipt payloads remain unchanged.
   Any other mismatch uses the admin row's explicit sizing-review fields before Create.
4. Build `npm ci && npm run build`; start `npm run serve` on loopback. For a mount,
   build with `VITE_BASE_PATH=/candidate/` and serve with `BASE_PATH=/candidate`.
   The reverse proxy must preserve this prefix and origin, support SPA fallback, and
   pass Cookie, Set-Cookie and X-Saffron-CSRF. Never cache `/vault-requests` responses.
5. Configure the API with public `SAFFRON_ADMIN_WALLETS` (comma-separated),
   `SAFFRON_CREATOR_ADDRESS`, and exact `SAFFRON_APP_ORIGIN`. Factory ownership does
   not grant access. Operators sign once for 30 minutes; sessions expire/revoke on restart.
   Catalog changes retain their separate, action-bound signatures and revision checks.
6. Configure read-only chain RPCs on the server. Leave request fee collection disabled
   until the candidate is ready for paid requests; receipt recovery stays available.

## Provision the local signer separately

Use a dedicated test EOA; do not use it concurrently outside this worker. Enter its
key only through a **host-owned masked credential prompt**, stored encrypted by the
host (for example systemd encrypted credentials). Never use chat, shell arguments,
plain environment variables, repository files or the API to supply a key. If protected
credential injection is unavailable, provision it externally on the host; do not fall
back to collecting the key in a transcript.

The included systemd unit receives `creator-eoa` using `LoadCredentialEncrypted`.
Its decrypted owner-only read-only path goes in `signerCredentialFile`. The configured
public `signerAddress` must match it. The web-server service user must not be able to
read this credential. Keep operator configuration outside the checkout, owner-only,
and RPC authentication in the host's protected network/credential setup.

Before enabling, run the read-only inspector:

```sh
npm run worker:inspect -- "<worker-config-file>"
```

It prints only public chain/factory/type hashes and the observation block. Independently
compare registered bytecode to the intended UniV3Vault and full-range adapter deployment
artifacts; merely copying hashes from a compromised endpoint is not verification.
Select the actual registered type IDs, gas limits and maximum premium **raw units**.
`maxPremiumRaw` is a per-vault ceiling, not a total spending budget. Each vault's premium
also requires its own explicit admin approval. Ensure native gas and the selected reward
asset are present in the creator wallet. Provision the matching protected database role.

Only then set `enabled: true` and install/start the included unit, or run:

```sh
npm run worker -- "<worker-config-file>"
```

The same EOA owns adapter creation, vault creation and initialization. The API never
spawns a shell command or signs. It only records reviewed, authenticated jobs; a local
agent can invoke the same worker with `--once` rather than keeping a service running.

## Run a request

1. User submits the existing paid request, or imports its original receipt.
2. Operator opens `/admin/requests`, signs in and clicks **Create vault**. This binds
   the current request digest and optional explicit sizing snapshot to one durable job.
3. Worker resolves fresh USD/APR into exact liquidity and premium. It pins chain,
   factory/type code hashes, token metadata, pool fee/range, fee basis points, prices
   and sizing block. This snapshot stays fixed across retries. No LP assets move.
4. After verified initialization, the row is **Awaiting admin funding**. Expand
   **Admin premium funding** and approve its exact upper budget. Creation alone never
   authorizes this spend. The worker approves the reward asset to the vault and deposits
   only remaining variable capacity; external admin deposits are also observed.
5. Profile becomes **Depositable** only on canonical, recent, fully funded and
   unoccupied on-chain evidence. Click **Deposit** to open the original page-two body.
   User wallet approves LP tokens to the adapter (never an unverified router), wraps
   ETH if needed, and explicitly deposits on side 0. There is no second request fee.

Creation/funding use two canonical confirmations. The observer polls every 5 seconds;
15-second-old snapshots and chain heads older than 60 seconds close eligibility.
Raw bearer supply must equal premium capacity and the vault's asset balance must cover
it. A token transfer alone, wallet bearer balance, queued transaction or admin checkbox
cannot open the gate. Occupied/started vaults are unavailable even after claims burn.

## Recovery, limitations, rollback

- PostgreSQL holds the signer advisory lock and job lease. Signed bytes, nonce, expected
  calldata and hash are durable **before broadcast**. Unknown receipt/nonce outcomes keep
  the same transaction; no blind replacement. Creation resumes step by step.
- Confirmed reverts require explicit Resume. Separately approved funding can be renewed
  after a confirmed failure or a pre-start withdrawal; each renewal has its own revision.
  Pending transactions are reconciled first, even if another admin has filled capacity.
- Browser intents and returned hashes survive reload. A lost wallet response requires the
  existing transaction hash; a successful unrelated replacement cannot clear the record.
  Only confirmed matching actions/cancellations/reverts allow normal retries.
- The app gate cannot freeze premium or reserve the vault onchain. The existing vault
  permits a fixed deposit while underfunded. Fresh reads/simulation reduce races, not
  eliminate them. If funding changes before mining, a confirmed fixed deposit can still
  await funding; the UI does not promise that it necessarily started.
- To pause: remove the public creator configuration from the API to stop new approvals,
  then stop the worker. Preserve the queue, snapshots and transaction table. Reconcile
  every previously signed transaction before resuming or changing signers. Do not delete
  rows to retry. Stale observations automatically disable Deposit during an outage.
- Rollback restores application binaries/configuration, not destructive database resets.
  Stop new approvals first. Keep the additive sidecars and signed payment evidence.
  Existing apps and indexer tables need not be rewritten by the feature observer.

## Verification boundary

`npm test`, `npm run test:database`, `npm run test:lifecycle`, `npm run build`, and
`npm run test:browser` cover the new lifecycle and retained fee/recovery/catalog behavior.
Native EVM tests execute original pinned Saffron factory/vault/adapter contracts, with
valueless tokens and a position-manager double. They do not prove the live deployed
bytecode or live Uniswap position-manager behavior. Root live/mock checks remain separate.

Live completion requires an authorized EOA, real creation/initialization and full admin
funding, followed by opening the now-enabled native modal. A real LP deposit is optional.
Do not report this live milestone from the local test suite alone.

### Read-only live inspection, 9 September 2026

On chain 4663 at block `0x37d621f`, this factory's registered vault type 1 and
full-range adapter type 2 matched the exact init-code hashes in fixed-income's
`packages/api-types/src/bytecodeHashes.generated.ts` at source commit
`9f112e6115816fd8fbe0475ccb59c5f6519416e7`. Those hashes and the observed factory
runtime hash are prefilled in the disabled example. Adapter type 1 is limited
range, not the type this flow needs. Reinspect before enabling. This was read-only;
it is not live creation/funding acceptance or an independent security audit.
