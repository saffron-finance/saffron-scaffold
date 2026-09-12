# Liquidity incentives package

This independently operated application supplements the scaffold root app.
Keep the root Pages build static/read-only. The API, PostgreSQL schema, worker
and explicitly vendored UI/protocol sources belong to this package. Maintain
these components as application-owned build, test and runtime infrastructure.

Read README.md and server/AGENTS.md before backend edits. Public protocol and
upstream Saffron API URLs are intentional; private deployments, credentials and
operator records must never be committed. Follow the current campaign/payment specification in CAMPAIGNS.md: a $2 native
ETH payment binds the exact deployment quote, without user message signatures.
Keep atomic paid-commitment accounting and reviewed or automatic worker creation.
Budget/capacity targets are private, advisory planning inputs, never admission
limits. Show near-capacity notices only on the authenticated operator portfolio.
Do not add per-user request quotas, C05 tracking, refund/retirement workflows,
gas-spending ledgers, or treasury balance/inventory tracking. Premium funding is external. Do not reintroduce worker funding, a USDC fee choice, legacy
receipt imports or an admin per-vault creation form. Campaign creation belongs in
the operator interface. IMPLEMENTATION.md defines the current state contract.

Production catalog/budgets start empty; only disposable fixtures may seed funded
rows. Preserve new intent idempotency, pending transaction recovery and canonical
evidence. Spent premium never replenishes a campaign. The HTTP process cannot
sign or broadcast; protected signer custody belongs to the separate worker.
Tests use random disposable databases and generated local-only wallets. Do not
activate live signing/funding for validation or modify the root app to run tests.

Never force-push or merge a feature branch into main without authorization.
Keep dev controls isolated from src/incentives.
Use the current feature branch and repository Git identity for modular commits.
Run the README's focused checks and normal/lab builds for affected behavior.
