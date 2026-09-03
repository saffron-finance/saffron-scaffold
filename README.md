# <img src="./public/saffron-icon.svg" alt="" width="28" height="28" /> Saffron Scaffold

**[Live preview here](https://saffron-finance.github.io/saffron-scaffold/)**

**[Fixed + variable yield branch preview](https://saffron-finance.github.io/saffron-scaffold/previews/yield-side-selector-preview/)**

A standalone React application for Saffron's variable and fixed yield flows.
The live build reads variable-side capacity directly onchain and supports
wallet-confirmed variable deposits. The fixed-yield view matches a one-asset
budget against the reviewed Cash Cat opportunity and stages its exact-vault
LI.FI handoff.

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
have public RPC fallbacks. Robinhood Chain requires an RPC URL.

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
`BIND_HOST`, and optional `BASE_PATH` environment variables when needed.

Production browser requests use the same-origin `/rpc/<chain>` endpoint. The
Node server forwards only an explicit allowlist of read-only JSON-RPC methods,
so upstream RPC credentials remain server-side. Wallet approvals and deposits
are sent directly through the connected browser wallet.

Never expose private RPC URLs through `VITE_RPC_*` in a public production
build. Those variables are intended only for local development.

## Verification

```bash
npm run build
rg -n -i 'api.key|secret|password|private.key' dist
```

The second command should return no matches.

## Static example

`npm run build:mock` creates a serverless build from the committed onchain
fixture in `src/mock/snapshot.json`. It performs no RPC requests, requests no
wallet, and disables transaction actions. Vault rows remain clickable and the
fixed-yield amount matcher remains interactive with an explicit preview-only
handoff. GitHub Actions publishes the branch build below the main GitHub Pages
site at
<https://saffron-finance.github.io/saffron-scaffold/previews/yield-side-selector-preview/>.

**For agents:** Read [`AGENTS.md`](./AGENTS.md) before making changes and
[`server/AGENTS.md`](./server/AGENTS.md) before touching the server; for
operational context not duplicated there, also consult
[`scripts/README.md`](./scripts/README.md), [`ops/README.md`](./ops/README.md),
and the [GitHub Pages workflow](./.github/workflows/pages.yml).
