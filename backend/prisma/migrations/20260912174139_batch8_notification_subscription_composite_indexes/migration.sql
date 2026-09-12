-- NOTE: prisma migrate dev ALSO proposed dropping the pg_trgm GIN
-- indexes created by 20260906000000_add_pg_trgm_indexes (they are a
-- raw-SQL optimization, not declared in schema.prisma, so Prisma
-- treats them as drift). Dropping them would silently destroy the
-- search acceleration they provide, so those DROP statements are
-- deliberately NOT part of this migration — the trigram indexes stay
-- in place for any database that runs this migration.
--
-- The CREATE statements below are the ones Prisma generated: the two
-- schema-declared composite indexes this change adds (Batch 8 Item S),
-- plus four schema-declared @@index composites that were never
-- materialized by any earlier migration (customers/sales/notification
-- user-scoped columns) — creating them here brings real databases
-- into line with what schema.prisma already promised.

-- CreateIndex
CREATE INDEX "customers_showroom_id_national_id_idx" ON "customers"("showroom_id", "national_id");

-- CreateIndex
CREATE INDEX "customers_showroom_id_phone_idx" ON "customers"("showroom_id", "phone");

-- CreateIndex
CREATE INDEX "notifications_showroom_id_user_id_idx" ON "notifications"("showroom_id", "user_id");

-- CreateIndex
CREATE INDEX "notifications_showroom_id_is_read_created_at_idx" ON "notifications"("showroom_id", "is_read", "created_at");

-- CreateIndex
CREATE INDEX "sales_showroom_id_customer_id_idx" ON "sales"("showroom_id", "customer_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_expires_at_idx" ON "subscriptions"("status", "expires_at");
