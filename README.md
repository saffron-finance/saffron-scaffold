# <img src="./public/saffron-icon.svg" alt="" width="28" height="28" /> Saffron Scaffold

**[Live preview here](https://saffron-finance.github.io/saffron-scaffold/)**

A standalone React application for browsing both sides of Saffron vaults.
Variable-side capacity is read directly onchain and supports an injected-wallet
deposit. The fixed-side selector uses Saffron's public, read-only vault list so
it can show the production APR, upfront premium, USD capacity, term, and exact
required Uniswap pair. Fixed depositors can either hand off to the audited pair
deposit route or use a minimal LI.FI zap that funds the position with one of the
two vault tokens on the same chain.

This repository contains the standalone Saffron Scaffold interface and no
deployment-specific URL.

## Supported networks

| Network | Chain ID | Factory |
|---|---:|---|
| Ethereum | 1 | `0x7fE802B891734DB681b7353bFF9E6c85ce0ab200` |
| Arbitrum | 42161 | `0xd4E8582e36AF0E0d5c1bcd8303984870b086d3d2` |
| Robinhood Chain | 4663 | `0xb24b143ad6bB5bE9559CcC75f34A2261b7456904` |

Vaults are enumerated from each factory with `nextVaultId()` and
`vaultInfo(id)`. Vault state, token metadata, capacities, and Uniswap position
ranges are read directly from contracts.

## Local development

```bash
npm install
cp .env.example .env
# Add any private development RPC URLs to .env.
npm run dev
```

The development server runs at `http://localhost:5180`. Ethereum and Arbitrum
have public RPC fallbacks. Robinhood Chain requires an RPC URL. The Vite-only
server does not expose the LI.FI quote route; to exercise a zap locally, add the
server-only settings to the ignored `.env`, run `chmod 600 .env`, then use
`npm run build && npm run serve`.

## Production

```bash
npm install
npm run build
RPC_ETHEREUM=https://example.invalid \
RPC_ARBITRUM=https://example.invalid \
RPC_ROBINHOOD=https://example.invalid \
npm run serve
```

The Node server listens on `127.0.0.1:3200` by default. Configure `PORT`,
`BIND_HOST`, and optional `BASE_PATH` environment variables when needed. A live
zap deployment also requires server-only `LIFI_API_KEY` and `LIFI_INTEGRATOR`
values. Put them in the root-readable service environment file described in
[`ops/README.md`](./ops/README.md), never in a `VITE_*` variable.

Production browser requests use the same-origin `/rpc/<chain>` endpoint. The
Node server forwards only an explicit allowlist of read-only JSON-RPC methods,
so upstream RPC credentials remain server-side. Wallet approvals and deposits
are sent directly through the connected browser wallet. The same server also
offers a narrow GET-only `/fixed-vaults/<chain>` bridge to the public Saffron
vault-list API; its filters and upstream origin are fixed server-side.

The same server exposes `POST /zaps/quote` for the fixed-side zap. It accepts
only a same-chain direct-source intent with exactly four locally authored calls:
the verified Uniswap swap, two adapter allowance probes, and the fixed vault
deposit. It binds the vault, adapter, pair, fee, claim token, factory, executor,
approval address, sender, amount, and refund receiver before returning LI.FI
calldata. The browser repeats the LI.FI envelope validation, uses an exact
finite ERC-20 approval, refreshes stale quotes, and preflights the complete
transaction before asking the wallet to submit it. Cross-chain and arbitrary
source-token conversion are intentionally outside this first version.

Never expose private RPC URLs through `VITE_RPC_*` in a public production
build. Those variables are intended only for local development.

## Verification

```bash
npm run test:zap
npm run build
npm run build:mock
rg -n -i 'api.key|secret|password|private.key' dist
```

The second command should return no matches.

## Static example

`npm run build:mock` creates a serverless, read-only build from the committed
variable and fixed vault fixtures. It performs no RPC or API requests and
disables wallet actions. Both sets of vault rows remain clickable and open
populated deposit modals for UI demonstrations, but the modals cannot connect a
wallet or submit a transaction. GitHub Actions publishes that build to GitHub Pages on
every push to `main` at
<https://saffron-finance.github.io/saffron-scaffold/>.

**For agents:** Read [`AGENTS.md`](./AGENTS.md) before making changes and
[`server/AGENTS.md`](./server/AGENTS.md) before touching the server; for
operational context not duplicated there, also consult
[`scripts/README.md`](./scripts/README.md), [`ops/README.md`](./ops/README.md),
and the [GitHub Pages workflow](./.github/workflows/pages.yml).
