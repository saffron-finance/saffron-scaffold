# Agent guide

## Goal

- Maintain a standalone interface for discovering live Saffron variable-side
  vault capacity and submitting explicit wallet-confirmed deposits.
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
- The relay is read-only. Do not add signing, account, transaction-broadcast,
  trace, debug, or admin RPC methods without a security review.

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
- Do not reintroduce retired branding, alternate product routes, or
  deployment-specific hostnames. The product/package name is Saffron Scaffold
  / `saffron-scaffold`.
- Treat addresses and decimals as authoritative; symbols are presentation only.

## Required checks

1. Run `npm ci`, `npm run build`, and `npm run build:mock`.
2. Serve the mock `dist` and confirm filters, sorting, pagination, icons, and
   ranges render without any `/rpc/` network request or wallet action.
3. For live changes, test each configured `eth_chainId`, verify vaults load,
   and confirm a disallowed relay method returns HTTP 403.
4. Scan tracked paths and contents for credentials, retired names, and private
   deployment domains.
5. Review `git diff`, preserve unrelated work, commit to `main`, and never
   force-push.
