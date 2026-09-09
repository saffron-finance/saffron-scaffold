-- Feature sidecars only: the canonical pending table and signed receipts keep
-- their existing schema and meanings. Worker data is never returned wholesale.
CREATE TABLE IF NOT EXISTS liqifi.vault_creation_jobs (
  request_id VARCHAR(12) PRIMARY KEY REFERENCES uniswap_v3_fiv.pending_vaults(request_id),
  chain_id INTEGER NOT NULL CHECK (chain_id = 4663),
  factory VARCHAR(42) NOT NULL,
  operator VARCHAR(42) NOT NULL,
  signer VARCHAR(42) NOT NULL,
  approved_digest VARCHAR(66) NOT NULL,
  receipt_digest VARCHAR(66) NOT NULL,
  snapshot JSONB NOT NULL,
  plan JSONB,
  state TEXT NOT NULL DEFAULT 'queued' CHECK (state IN ('queued','running','waiting','failed','created')),
  resume_version INTEGER NOT NULL DEFAULT 0,
  funding_state TEXT NOT NULL DEFAULT 'unapproved' CHECK (funding_state IN ('unapproved','queued','running','waiting','failed','funded')),
  funding_operator VARCHAR(42),
  funding_max_raw NUMERIC(78,0),
  lease_owner UUID,
  lease_until TIMESTAMPTZ,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS liqifi.vault_creation_transactions (
  id BIGSERIAL PRIMARY KEY,
  request_id VARCHAR(12) NOT NULL REFERENCES liqifi.vault_creation_jobs(request_id),
  step TEXT NOT NULL,
  resume_version INTEGER NOT NULL,
  signer VARCHAR(42) NOT NULL,
  nonce BIGINT NOT NULL,
  hash VARCHAR(66) NOT NULL UNIQUE,
  raw_tx TEXT NOT NULL,
  transaction_data JSONB NOT NULL,
  receipt JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (signer, nonce)
);
CREATE TABLE IF NOT EXISTS liqifi.vault_readiness (
  request_id VARCHAR(12) PRIMARY KEY REFERENCES uniswap_v3_fiv.pending_vaults(request_id),
  snapshot JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS liqifi.vault_worker_heartbeats (
  signer VARCHAR(42) PRIMARY KEY,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
