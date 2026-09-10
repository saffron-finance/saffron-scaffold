# Liquidity incentives package

This standalone feature supplements, and does not replace, the scaffold root
application. Keep the root Pages build static/read-only. The optional server,
PostgreSQL dependency and pinned UI snapshot are confined to this package.

Read README.md and server/AGENTS.md before backend edits. Public protocol and
upstream Saffron API URLs are intentional; private deployments, credentials and
operator records must never be committed. Preserve message/storage/schema names
used by existing receipts. Tests must use disposable databases and unfunded
wallet fixtures. Do not modify the root app merely to run this package.

Never force-push or merge a feature branch into main without authorization.
Keep dev controls isolated from src/incentives.
