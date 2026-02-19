-- ============================================================
-- Migration 002: Increase price column precision
--
-- NUMERIC(18,6) stores only 6 decimal places, which is not
-- enough for sub-cent tokens like BONK (~$0.000006).
-- Example: mid_price 0.00000611 was stored as 0.000006,
-- and spread_usd 0.00000002 was stored as 0.000000.
--
-- Changing to NUMERIC(20,10) preserves 10 decimal places,
-- which is sufficient for any token priced above $0.0000000001.
-- ============================================================

ALTER TABLE depth_metrics
  ALTER COLUMN mid_price  TYPE NUMERIC(20,10),
  ALTER COLUMN best_bid   TYPE NUMERIC(20,10),
  ALTER COLUMN best_ask   TYPE NUMERIC(20,10),
  ALTER COLUMN spread_usd TYPE NUMERIC(20,10);

ALTER TABLE hourly_metrics
  ALTER COLUMN median_mid_price TYPE NUMERIC(20,10);
