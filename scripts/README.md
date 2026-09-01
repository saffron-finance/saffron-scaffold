# scripts

Node scripts (run with `node scripts/<name>.mjs`). They read RPC URLs from the project `.env`
(falling back to public RPCs where noted). None contain secrets.

## Everyday tools (`scripts/`)

- **`check-chain.mjs`** — quick sanity read: enumerate vaults on each factory and print the first few
  with their variable-side snapshot. Fast way to confirm the chains/RPC are healthy.
- **`list-depositors.mjs`** — scan a vault's variable-side `FundsDeposited` logs and list depositors,
  demonstrating the funding-window bounding. `node scripts/list-depositors.mjs [chain] [vaultAddr]`.

## One-off diagnostics (`scripts/diagnostics/`)

Kept for reference; each answered a specific question during the build and is not needed day-to-day.

- **`probe-rpc.mjs`** — surface raw `eth_getLogs` errors / range limits per RPC.
- **`probe-paid.mjs`** — confirm the paid QuickNode endpoints (vault counts + getLogs range).
- **`probe-multicall.mjs`** — check Multicall3 presence on each chain.
- **`time-load.mjs`** — measure the multicall load time across all chains.
