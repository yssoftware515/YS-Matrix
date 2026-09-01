-- ============================================================
-- Phase A (P1-2) — one PENDING_PAYMENT claim per showroom.
--
-- Pre-condition: the application previously allowed concurrent
-- duplicate PENDING_PAYMENT claims (findFirst-then-create under
-- READ COMMITTED with only a non-unique [showroom_id, status]
-- index). If any duplicates already exist in the target database,
-- deterministic cleanup runs FIRST, then the unique partial index
-- is created as the invariant backstop.
--
-- Cleanup policy (deterministic, lifecycle-consistent):
--   • subscriptions: the OLDEST PENDING_PAYMENT row per showroom is
--     CANCELLED with a documented reason; the newest stays
--     PENDING_PAYMENT (the customer's latest intent wins).
--   • payments linked to the cancelled rows move PENDING → EXPIRED —
--     the honest "no longer collectable" state, matching the
--     existing cancelPendingRequest semantics. They are never left
--     dangling as collectable PENDING rows.
-- ============================================================

-- 1. Deterministic dedup: keep the newest PENDING_PAYMENT claim per
--    showroom, cancel every older one.
UPDATE "subscriptions"
SET status = 'CANCELLED',
    notes  = COALESCE(notes || E'\n', '') || 'Phase A cleanup: duplicate PENDING_PAYMENT claim — older request cancelled automatically.'
WHERE status = 'PENDING_PAYMENT'
  AND id NOT IN (
    SELECT DISTINCT ON (showroom_id) id
    FROM "subscriptions"
    WHERE status = 'PENDING_PAYMENT'
    ORDER BY showroom_id, created_at DESC
  );

-- 2. PENDING payments of the just-cancelled duplicates are no longer
--    collectable → EXPIRED (same state cancelPendingRequest uses).
UPDATE "payments"
SET status = 'EXPIRED'
WHERE status = 'PENDING'
  AND subscription_id IN (
    SELECT id
    FROM "subscriptions"
    WHERE notes LIKE 'Phase A cleanup: duplicate PENDING_PAYMENT claim%'
  );

-- 3. The invariant backstop: at most one PENDING_PAYMENT per showroom.
CREATE UNIQUE INDEX "subscriptions_one_pending_per_showroom"
ON "subscriptions" ("showroom_id")
WHERE status = 'PENDING_PAYMENT';
