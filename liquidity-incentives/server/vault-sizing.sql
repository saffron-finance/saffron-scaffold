-- Version the projection, not the immutable signed receipt. Only untouched,
-- pending incentive requests with the former catalog-sized capacity are repaired.
ALTER TABLE liqifi.request_payments ADD COLUMN IF NOT EXISTS sizing_version SMALLINT NOT NULL DEFAULT 1;
WITH amounts AS (
  SELECT pending_request_id,
    CASE WHEN length(payload #>> '{incentive,depositUsd}') <= 50
      AND (payload #>> '{incentive,depositUsd}') ~ '^[0-9]+(\.[0-9]+)?$'
      THEN (payload #>> '{incentive,depositUsd}')::numeric END AS deposit_usd,
    CASE WHEN jsonb_typeof(payload #> '{incentive,capacityUsd}') = 'number'
      THEN (payload #>> '{incentive,capacityUsd}')::numeric END AS old_capacity
  FROM liqifi.request_payments WHERE sizing_version = 1 AND payload->>'kind' = 'incentive'
)
UPDATE uniswap_v3_fiv.pending_vaults pv
SET fixed_capacity_amount = a.deposit_usd * 100, updated_at = CURRENT_TIMESTAMP
FROM amounts a
WHERE pv.request_id = a.pending_request_id AND pv.status = 'pending'
  AND pv.reviewed_at IS NULL AND pv.reviewed_by IS NULL AND pv.admin_notes IS NULL
  AND pv.created_vault_address IS NULL AND pv.adapter_type = 'fullRange'
  AND pv.fixed_capacity_token_address = '0x0000000000000000000000000000000000555344'
  AND pv.fixed_capacity_amount = a.old_capacity * 100
  AND a.deposit_usd > 0 AND a.deposit_usd <= 1000000000000
  AND a.deposit_usd = ROUND(a.deposit_usd, 2);
-- Reviewed/created requests retain their existing terms. Handoff separately
-- refuses a pending request whose capacity does not match its signed deposit.
UPDATE liqifi.request_payments SET sizing_version = 2 WHERE sizing_version = 1;
