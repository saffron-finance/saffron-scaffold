-- Initial schema for a new, independently operated application. No legacy imports.
CREATE SCHEMA IF NOT EXISTS saffron_incentives;
CREATE TABLE IF NOT EXISTS saffron_incentives.pairs (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision > 0), body JSONB NOT NULL,
  updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS saffron_incentives.budget_pools (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision > 0), name TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id=4663), reward_asset TEXT NOT NULL, decimals INTEGER NOT NULL CHECK (decimals BETWEEN 0 AND 18),
  limit_raw NUMERIC(78,0) NOT NULL CHECK (limit_raw>=0), reserved_raw NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (reserved_raw>=0),
  allocated_raw NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (allocated_raw>=0), paused BOOLEAN NOT NULL DEFAULT FALSE,
  reconciliation_required BOOLEAN NOT NULL DEFAULT FALSE, updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (reserved_raw+allocated_raw<=limit_raw)
);
CREATE TABLE IF NOT EXISTS saffron_incentives.programs (
  id TEXT PRIMARY KEY, revision INTEGER NOT NULL CHECK (revision>0), pair_id TEXT NOT NULL REFERENCES saffron_incentives.pairs(id),
  budget_pool_id TEXT NOT NULL REFERENCES saffron_incentives.budget_pools(id), body JSONB NOT NULL,
  updated_by TEXT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS saffron_incentives.checkout_clients (
  id TEXT PRIMARY KEY,peer_hash TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS checkout_clients_issued ON saffron_incentives.checkout_clients(created_at);
CREATE TABLE IF NOT EXISTS saffron_incentives.deployment_quotes (
  id UUID PRIMARY KEY, wallet TEXT NOT NULL, program_id TEXT NOT NULL REFERENCES saffron_incentives.programs(id),
  budget_pool_id TEXT NOT NULL REFERENCES saffron_incentives.budget_pools(id), body JSONB NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  client_hash TEXT REFERENCES saffron_incentives.checkout_clients(id),request_key TEXT,
  hold_state TEXT NOT NULL DEFAULT 'held' CHECK(hold_state IN ('held','closing','accepted','released')),
  hold_raw NUMERIC(78,0) NOT NULL CHECK(hold_raw>0),sizing_block BIGINT NOT NULL CHECK(sizing_block>=0),
  settled_cursor TEXT,settled_block BIGINT,settled_hash TEXT
);
CREATE INDEX IF NOT EXISTS quotes_holds ON saffron_incentives.deployment_quotes(budget_pool_id,hold_state);
CREATE UNIQUE INDEX IF NOT EXISTS quotes_client_request ON saffron_incentives.deployment_quotes(client_hash,request_key) WHERE client_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS quotes_wallet_time ON saffron_incentives.deployment_quotes(wallet,created_at);
CREATE TABLE IF NOT EXISTS saffron_incentives.deployment_intents (
  id UUID PRIMARY KEY, quote_id UUID NOT NULL UNIQUE REFERENCES saffron_incentives.deployment_quotes(id), wallet TEXT NOT NULL,
  budget_pool_id TEXT NOT NULL REFERENCES saffron_incentives.budget_pools(id), signature TEXT NOT NULL, plan_hash TEXT NOT NULL,
  snapshot JSONB NOT NULL, accepted_plan JSONB NOT NULL, status TEXT NOT NULL DEFAULT 'queued',
  cancel_requested BOOLEAN NOT NULL DEFAULT FALSE, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS intents_wallet_time ON saffron_incentives.deployment_intents(wallet,created_at DESC);
CREATE INDEX IF NOT EXISTS intents_page ON saffron_incentives.deployment_intents(created_at DESC,id DESC);
CREATE INDEX IF NOT EXISTS intents_wallet_page ON saffron_incentives.deployment_intents(wallet,created_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS saffron_incentives.budget_reservations (
  intent_id UUID PRIMARY KEY REFERENCES saffron_incentives.deployment_intents(id), budget_pool_id TEXT NOT NULL REFERENCES saffron_incentives.budget_pools(id),
  premium_raw NUMERIC(78,0) NOT NULL CHECK (premium_raw>0), reserved_raw NUMERIC(78,0) NOT NULL CHECK (reserved_raw>=0),
  allocated_raw NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (allocated_raw>=0), released_raw NUMERIC(78,0) NOT NULL DEFAULT 0 CHECK (released_raw>=0),
  expires_at TIMESTAMPTZ NOT NULL, CHECK (reserved_raw+allocated_raw+released_raw=premium_raw)
);
CREATE TABLE IF NOT EXISTS saffron_incentives.budget_entries (
  id BIGSERIAL PRIMARY KEY, event_key TEXT NOT NULL UNIQUE, budget_pool_id TEXT NOT NULL REFERENCES saffron_incentives.budget_pools(id),
  intent_id UUID REFERENCES saffron_incentives.deployment_intents(id), kind TEXT NOT NULL,
  limit_delta NUMERIC(78,0) NOT NULL DEFAULT 0, reserved_delta NUMERIC(78,0) NOT NULL DEFAULT 0,
  allocated_delta NUMERIC(78,0) NOT NULL DEFAULT 0, actor TEXT NOT NULL, evidence JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS saffron_incentives.vault_jobs (
  intent_id UUID PRIMARY KEY REFERENCES saffron_incentives.deployment_intents(id), signer TEXT NOT NULL, factory TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id=4663), state TEXT NOT NULL DEFAULT 'queued', funding_state TEXT NOT NULL DEFAULT 'unapproved',
  plan JSONB NOT NULL, funding_max_raw NUMERIC(78,0), funding_operator TEXT, operation TEXT NOT NULL DEFAULT 'create',
  resume_version INTEGER NOT NULL DEFAULT 0, funding_round INTEGER NOT NULL DEFAULT 0, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  lease_owner TEXT, lease_until TIMESTAMPTZ, error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS saffron_incentives.chain_operations (
  id BIGSERIAL PRIMARY KEY, intent_id UUID NOT NULL REFERENCES saffron_incentives.deployment_intents(id), step TEXT NOT NULL,
  signer TEXT NOT NULL, nonce BIGINT NOT NULL CHECK (nonce>=0), resume_version INTEGER NOT NULL, hash TEXT NOT NULL UNIQUE,
  raw_tx TEXT NOT NULL, transaction_data JSONB NOT NULL, receipt JSONB, resolved_hash TEXT, resolution_kind TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (signer,nonce), UNIQUE(intent_id,step,resume_version)
);
CREATE TABLE IF NOT EXISTS saffron_incentives.vault_observations (
  intent_id UUID PRIMARY KEY REFERENCES saffron_incentives.deployment_intents(id), snapshot JSONB NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS observations_position_owners ON saffron_incentives.vault_observations USING gin ((snapshot->'positionOwners'));
CREATE TABLE IF NOT EXISTS saffron_incentives.worker_heartbeats (
  signer TEXT PRIMARY KEY, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS saffron_incentives.user_operations (
  hash TEXT PRIMARY KEY,intent_id UUID NOT NULL REFERENCES saffron_incentives.deployment_intents(id),wallet TEXT NOT NULL,
  action TEXT NOT NULL,receipt JSONB NOT NULL,canonical BOOLEAN NOT NULL DEFAULT TRUE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS user_operations_wallet_intent ON saffron_incentives.user_operations(wallet,intent_id) WHERE canonical=TRUE;

-- Additive migration for externally funded USD campaigns and ETH payment proofs.
-- Existing journals/commitments are retained; no legacy tables are dropped.
ALTER TABLE saffron_incentives.budget_pools ADD COLUMN IF NOT EXISTS campaign JSONB;
ALTER TABLE saffron_incentives.deployment_intents ALTER COLUMN signature DROP NOT NULL;
CREATE TABLE IF NOT EXISTS saffron_incentives.payment_proofs (
  hash TEXT PRIMARY KEY, quote_id UUID NOT NULL UNIQUE REFERENCES saffron_incentives.deployment_quotes(id),
  wallet TEXT NOT NULL, evidence JSONB NOT NULL, state TEXT NOT NULL DEFAULT 'verified',
  error TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- A keyless scanner can discover a mined fee even if the browser loses its hash.
-- This is the same public commitment carried in payment calldata, not a secret.
ALTER TABLE saffron_incentives.deployment_quotes ADD COLUMN IF NOT EXISTS payment_commitment TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS quotes_payment_commitment ON saffron_incentives.deployment_quotes(payment_commitment);
CREATE TABLE IF NOT EXISTS saffron_incentives.payment_scan_cursors (
  id TEXT PRIMARY KEY,chain_id INTEGER NOT NULL CHECK(chain_id=4663),
  start_block BIGINT NOT NULL CHECK(start_block>=0),block_number BIGINT,block_hash TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS saffron_incentives.payment_exceptions (
  hash TEXT PRIMARY KEY,quote_id UUID NOT NULL REFERENCES saffron_incentives.deployment_quotes(id),
  kind TEXT NOT NULL,evidence JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS saffron_incentives.payment_obligations (
  hash TEXT PRIMARY KEY,quote_id UUID NOT NULL REFERENCES saffron_incentives.deployment_quotes(id),
  wallet TEXT NOT NULL,amount_wei NUMERIC(78,0) NOT NULL CHECK(amount_wei>0),kind TEXT NOT NULL,
  evidence JSONB NOT NULL,state TEXT NOT NULL DEFAULT 'received',revision INTEGER NOT NULL DEFAULT 1,
  execution_allowed BOOLEAN NOT NULL DEFAULT FALSE,admission_override JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS obligations_quote ON saffron_incentives.payment_obligations(quote_id);
CREATE TABLE IF NOT EXISTS saffron_incentives.payment_resolution_audit (
  id BIGSERIAL PRIMARY KEY,payment_hash TEXT NOT NULL REFERENCES saffron_incentives.payment_obligations(hash),
  actor TEXT NOT NULL,request_key UUID NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,
  expected_revision INTEGER NOT NULL,fingerprint TEXT NOT NULL,evidence JSONB,result JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),UNIQUE(actor,request_key)
);
CREATE TABLE IF NOT EXISTS saffron_incentives.refund_transfers (
  hash TEXT PRIMARY KEY,payment_hash TEXT NOT NULL REFERENCES saffron_incentives.payment_obligations(hash),
  amount_wei NUMERIC(78,0) NOT NULL CHECK(amount_wei>0),state TEXT NOT NULL CHECK(state IN ('confirming','confirmed','orphaned','failed')),
  evidence JSONB NOT NULL,resolved_hash TEXT,checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS refund_payment ON saffron_incentives.refund_transfers(payment_hash);
CREATE TABLE IF NOT EXISTS saffron_incentives.refund_evidence (
  hash TEXT PRIMARY KEY,transfer_hash TEXT NOT NULL REFERENCES saffron_incentives.refund_transfers(hash)
);
