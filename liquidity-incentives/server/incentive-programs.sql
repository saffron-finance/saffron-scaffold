-- Catalog data belongs to this feature; the existing FI pending-vault schema stays unchanged.
CREATE TABLE IF NOT EXISTS liqifi.incentive_pairs (
  id VARCHAR(80) PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  chain_id INTEGER NOT NULL CHECK (chain_id = 4663),
  pool_address VARCHAR(42) NOT NULL,
  fee_tier INTEGER NOT NULL CHECK (fee_tier IN (100,500,3000,10000)),
  token0 JSONB NOT NULL,
  token1 JSONB NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(42),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS liqifi.incentive_programs (
  id VARCHAR(80) PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  pair_id VARCHAR(80) NOT NULL REFERENCES liqifi.incentive_pairs(id),
  apr_percent NUMERIC NOT NULL CHECK (apr_percent >= 0.01 AND apr_percent <= 100000 AND apr_percent = ROUND(apr_percent,2)),
  duration_days INTEGER NOT NULL CHECK (duration_days > 0 AND duration_days <= 3650),
  capacity_usd NUMERIC NOT NULL CHECK (capacity_usd >= 0.01 AND capacity_usd <= 1000000000000 AND capacity_usd = ROUND(capacity_usd,2)),
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_new BOOLEAN NOT NULL DEFAULT FALSE,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  updated_by VARCHAR(42),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Existing fee quotes remain recoverable. Newly issued quotes bind the reviewed request snapshot.
ALTER TABLE liqifi.request_fee_quotes ADD COLUMN IF NOT EXISTS request_details JSONB;

-- One-time bootstrap of the former catalog. Never overwrite an administrator's edits or pauses.
INSERT INTO liqifi.incentive_pairs (id,chain_id,pool_address,fee_tier,token0,token1)
VALUES ('cashcat-eth',4663,'0xa70fc67c9f69da90b63a0e4c05d229954574e313',10000,
  '{"address":"0x020bfc650a365f8bb26819deaabf3e21291018b4","symbol":"CASHCAT","decimals":18}',
  '{"address":"0x0bd7d308f8e1639fab988df18a8011f41eacad73","symbol":"ETH","decimals":18}')
ON CONFLICT (id) DO NOTHING;
INSERT INTO liqifi.incentive_programs (id,pair_id,apr_percent,duration_days,capacity_usd,sort_order,is_new)
VALUES ('cashcat-eth-1000-3d','cashcat-eth',1000,3,100000,0,TRUE),
  ('cashcat-eth-800-2d','cashcat-eth',800,2,100000,1,FALSE),
  ('cashcat-eth-1200-14d','cashcat-eth',1200,14,100000,2,FALSE),
  ('cashcat-eth-2400-90d','cashcat-eth',2400,90,100000,3,FALSE)
ON CONFLICT (id) DO NOTHING;
