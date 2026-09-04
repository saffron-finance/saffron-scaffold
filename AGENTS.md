# Agent guide

This file applies to the entire repository. More specific `AGENTS.md` files
override it inside their directory; read `server/AGENTS.md` before changing the
production server or RPC relay.

## Goal

- Maintain a standalone interface for discovering live Saffron variable-side
  vault capacity and submitting explicit wallet-confirmed deposits.
- Keep the fixed-side LI.FI option minimal: same-chain, direct-source, and only
  one of the destination vault's two tokens. Do not enable arbitrary-token or
  cross-chain paths without independent execution evidence and security review.
- Keep the normal build onchain-driven and the GitHub Pages example completely
  static, read-only, and reproducible from committed mock data.

## Protocol facts

- The fixed side contributes a Uniswap V3 position. The variable side deposits
  an ERC-20 premium and receives LP fees; it does not simply receive its
  original deposit back.
- A vault starts only after both sides fill. Variable deposits call
  `deposit(amount, 1, "0x")`; side `1` is the variable side.
- `variableBearerToken.totalSupply()` is the authoritative 1:1 measure of
  variable deposits. Available capacity is
  `max(variableSideCapacity - totalSupply, 0)`.
- Before start, a nonzero claim-token supply proves the fixed deposit is
  present. After start, preserve that fact even if the claim token changes.
- Range and pair data come from the adapter and Uniswap pool (`pool`,
  `poolMinTick`, `poolMaxTick`, `poolKey`, and `slot0`), with token decimals
  applied to tick-price conversion.

## Architecture

- React, TypeScript, Vite, and `viem`; no database, indexer, pricing API, or
  server-side transaction signer.
- Live vault reads use factory enumeration and Multicall3 on Ethereum (1),
  Arbitrum (42161), and Robinhood Chain (4663). Factory addresses live only in
  `src/chain/chains.ts`.
- Production reads go through the same-origin `rpc/<chain>` Node relay. Wallet
  writes go directly through the injected wallet and never through that relay.
- LI.FI quote requests go through the same-origin `zaps/quote` server endpoint
  so the API key remains server-only. The browser must independently validate
  the returned executor transaction immediately before wallet use.
- The relay is read-only. Do not add signing, account, transaction-broadcast,
  trace, debug, or admin RPC methods without a security review.

## Repository map

- `src/chain/` owns chain configuration, ABIs, onchain reads, vault discovery,
  and deposit calldata construction.
- `src/wallet/` and wallet-facing components own injected-wallet interaction;
  every approval and deposit must remain an explicit user-confirmed wallet
  action.
- `src/zap/` owns fixed-side sizing, the four-call intent, quote validation,
  exact allowance handling, preflight, and execution. Keep its static contract
  address maps aligned with the independent server map.
- `src/mock/` owns the committed, read-only snapshot used by GitHub Pages.
- `server/` serves the production build and relays allowlisted RPC reads. Its
  additional security rules are in `server/AGENTS.md`.
- `scripts/` contains operator diagnostics and read-only inspection helpers.
- `ops/` contains deployment examples; never encode a live host or secret in
  them.
- `.github/workflows/pages.yml` builds only the static mock example. It must not
  deploy a live wallet or RPC-backed application to GitHub Pages.

## Change discipline

- Decide whether a change affects live mode, static mock mode, or both before
  editing. Do not let mock-only shortcuts enter live code paths.
- Keep deployment base paths portable. The Vite build deliberately uses a
  relative base so it can run at a domain root or beneath a path prefix.
- Prefer authoritative contract addresses, chain IDs, token decimals, and
  bigint strings over symbol-based inference or floating-point conversions.
- Preserve explicit loading, unavailable, empty, and error states. An RPC
  failure must not silently look like zero capacity.
- Keep dependencies small. This repository is intentionally standalone and
  has no dependency on the fixed-income monorepo at build or runtime.
- Do not commit generated `dist/`, local `.env` files, `node_modules/`, logs, or
  editor artifacts.

## Static example

- `npm run build:mock` uses `src/mock/snapshot.json`; it must make no RPC calls
  and must not expose wallet actions.
- GitHub Pages publishes that build at
  `https://saffron-finance.github.io/saffron-scaffold/`.
- The fixture is an onchain snapshot, not a test invention. Preserve bigint
  values as decimal strings in JSON and rehydrate them in `snapshot.ts`.
- Refresh the fixture intentionally from a verified live build, record its UTC
  `capturedAt`, and review the diff for unexpected chains, factories, or token
  metadata before committing.

## Security and naming

- Never commit `.env`, RPC credentials, provider tokens, private keys, wallet
  secrets, or production domains. Public builds must not embed `VITE_RPC_*`.
- Never expose the LI.FI API key through a `VITE_*` variable. It belongs only
  in the ignored local environment or the root-readable service environment.
- Do not reintroduce retired branding, alternate product routes, or
  deployment-specific hostnames. The product/package name is Saffron Scaffold
  / `saffron-scaffold`.
- Treat addresses and decimals as authoritative; symbols are presentation only.

## Required checks

1. Run `npm ci`, `npm run test:zap`, `npm run build`, and `npm run build:mock`.
2. Serve the mock `dist` and confirm filters, sorting, pagination, icons, and
   ranges render without any `/rpc/` network request or wallet action.
3. For live changes, test each configured `eth_chainId`, verify vaults load,
   and confirm a disallowed relay method returns HTTP 403.
4. Scan tracked paths and contents for credentials, retired names, and private
   deployment domains.
5. Review `git diff`, preserve unrelated work, commit to `main`, and never
   force-push.
