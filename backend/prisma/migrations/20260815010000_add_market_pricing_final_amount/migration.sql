-- Phase C.7 CORRECTION (2026-08-15) — authorized final amounts for the
-- four approved markets. ADDITIVE ONLY: adds the authoritative
-- final_amount column to market_pricing and backfills existing rows
-- with the approved customer-facing amounts (so any previously seeded
-- Egypt 10%/17% rows converge to the approved 7%/15% model). No data
-- is deleted; operator-adjusted rows keep base_amount/discount_percent
-- untouched — only the missing final_amount fact is filled.

-- AddColumn
ALTER TABLE "market_pricing" ADD COLUMN "final_amount" DECIMAL(10,2);

-- Backfill: set the approved final amount for the twelve approved
-- (market, currency, billing_period) combinations. Only fills rows
-- whose final_amount is still NULL — rows already carrying an approved
-- value (or a future operator decision) are left alone.
UPDATE "market_pricing" SET "final_amount" = CASE
  WHEN "billing_period" = 'MONTHLY'    THEN 350
  WHEN "billing_period" = 'SIX_MONTHS' THEN 1955
  WHEN "billing_period" = 'YEARLY'     THEN 3570
  ELSE NULL
END
WHERE "market" = 'EGYPT' AND "currency" = 'EGP' AND "final_amount" IS NULL;

UPDATE "market_pricing" SET "final_amount" = CASE
  WHEN "billing_period" = 'MONTHLY'    THEN 65
  WHEN "billing_period" = 'SIX_MONTHS' THEN 365
  WHEN "billing_period" = 'YEARLY'     THEN 665
  ELSE NULL
END
WHERE "market" = 'SAUDI_ARABIA' AND "currency" = 'SAR' AND "final_amount" IS NULL;

UPDATE "market_pricing" SET "final_amount" = CASE
  WHEN "billing_period" = 'MONTHLY'    THEN 65
  WHEN "billing_period" = 'SIX_MONTHS' THEN 365
  WHEN "billing_period" = 'YEARLY'     THEN 665
  ELSE NULL
END
WHERE "market" = 'UAE' AND "currency" = 'AED' AND "final_amount" IS NULL;

UPDATE "market_pricing" SET "final_amount" = CASE
  WHEN "billing_period" = 'MONTHLY'    THEN 19
  WHEN "billing_period" = 'SIX_MONTHS' THEN 105
  WHEN "billing_period" = 'YEARLY'     THEN 195
  ELSE NULL
END
WHERE "market" = 'GLOBAL' AND "currency" = 'USD' AND "final_amount" IS NULL;