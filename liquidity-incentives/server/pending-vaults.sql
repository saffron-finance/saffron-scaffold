-- Fixed-income compatibility: consolidated pending_vaults migrations through
-- 1785300000000, as read from saffron-fixed-income on 2026-09-06. Keep payment
-- evidence OUTSIDE this table, so its columns/units remain directly portable.
CREATE SCHEMA IF NOT EXISTS uniswap_v3_fiv;
CREATE SCHEMA IF NOT EXISTS liqifi;
CREATE TABLE IF NOT EXISTS uniswap_v3_fiv.pending_vaults (
  id SERIAL PRIMARY KEY,
  chain_id INTEGER NOT NULL,
  submitter_address VARCHAR(42) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  token0_address VARCHAR(42) NOT NULL,
  token1_address VARCHAR(42) NOT NULL,
  pool_address VARCHAR(42),
  fee_tier INTEGER NOT NULL CHECK (fee_tier IN (100,500,3000,10000)),
  adapter_type VARCHAR(20) NOT NULL CHECK (adapter_type IN ('limitedRange','fullRange')),
  min_tick INTEGER,
  max_tick INTEGER,
  duration_seconds BIGINT NOT NULL CHECK (duration_seconds > 0),
  fixed_capacity_token_address VARCHAR(42),
  fixed_capacity_amount NUMERIC(78,0) CHECK (fixed_capacity_amount IS NULL OR fixed_capacity_amount > 0),
  variable_asset_address VARCHAR(42) NOT NULL,
  variable_asset_amount NUMERIC(78,0) CHECK (variable_asset_amount IS NULL OR variable_asset_amount > 0),
  use_target_apr BOOLEAN NOT NULL DEFAULT FALSE,
  target_apr DECIMAL(10,4),
  notes TEXT,
  admin_notes TEXT,
  reviewed_by VARCHAR(42),
  reviewed_at TIMESTAMP,
  created_vault_address VARCHAR(42),
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  request_id VARCHAR(12) NOT NULL UNIQUE,
  is_advanced_mode BOOLEAN NOT NULL DEFAULT FALSE,
  telegram_chat_id TEXT,
  telegram_message_id BIGINT,
  submitter_telegram TEXT,
  submitter_discord TEXT,
  rejection_reason TEXT
);
CREATE INDEX IF NOT EXISTS pending_vaults_chain_id_idx ON uniswap_v3_fiv.pending_vaults(chain_id);
CREATE INDEX IF NOT EXISTS pending_vaults_submitter_address_idx ON uniswap_v3_fiv.pending_vaults(submitter_address);
CREATE INDEX IF NOT EXISTS pending_vaults_status_idx ON uniswap_v3_fiv.pending_vaults(status);
CREATE INDEX IF NOT EXISTS pending_vaults_chain_status_idx ON uniswap_v3_fiv.pending_vaults(chain_id,status);
CREATE INDEX IF NOT EXISTS pending_vaults_created_at_idx ON uniswap_v3_fiv.pending_vaults(created_at);
CREATE OR REPLACE FUNCTION uniswap_v3_fiv.touch_pending_vault() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = CURRENT_TIMESTAMP; RETURN NEW; END;
$$ LANGUAGE plpgsql;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname='update_pending_vaults_updated_at'
    AND tgrelid='uniswap_v3_fiv.pending_vaults'::regclass) THEN
    CREATE TRIGGER update_pending_vaults_updated_at BEFORE UPDATE ON uniswap_v3_fiv.pending_vaults
      FOR EACH ROW EXECUTE FUNCTION uniswap_v3_fiv.touch_pending_vault();
  END IF;
END $$;

-- Sidecar: payment uniqueness, signed terms, legacy IDs and exact deposit
-- intent. Old free-text general inquiries cannot invent missing vault fields;
-- preserve them here rather than manufacturing a false pending_vaults row.
CREATE TABLE IF NOT EXISTS liqifi.request_payments (
  payment_tx_hash VARCHAR(66) PRIMARY KEY,
  pending_request_id VARCHAR(12) UNIQUE REFERENCES uniswap_v3_fiv.pending_vaults(request_id),
  legacy_id TEXT NOT NULL UNIQUE,
  request_digest VARCHAR(66) NOT NULL,
  submitter_address VARCHAR(42) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS request_payments_submitter_idx ON liqifi.request_payments(submitter_address);
-- Quotes are persisted before wallet interaction so restart/reload cannot
-- change the exact fee owed by a payment that has already been broadcast.
CREATE TABLE IF NOT EXISTS liqifi.request_fee_quotes (
  id UUID PRIMARY KEY,
  wallet VARCHAR(42) NOT NULL,
  recipient VARCHAR(42) NOT NULL,
  asset VARCHAR(4) NOT NULL CHECK(asset IN ('USDC','ETH')),
  amount_raw NUMERIC(78,0) NOT NULL CHECK(amount_raw > 0),
  eth_usd_raw NUMERIC(78,0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMPTZ NOT NULL
);
