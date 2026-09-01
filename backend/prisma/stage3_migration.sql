-- ============================================================
-- YS-MATRIX ERP — Phase 2 Stage 3 Migration
-- Adds: Notification + Subscription models
-- Run: prisma migrate dev --name stage3_notifications_subscriptions
-- ============================================================

-- ── Notification ─────────────────────────────────────────────
CREATE TYPE "NotificationType" AS ENUM (
  'INSTALLMENT_OVERDUE',
  'INSTALLMENT_DUE_SOON',
  'LICENSE_EXPIRING',
  'LOW_STOCK',
  'SALE_CREATED',
  'SALE_CANCELLED',
  'PAYMENT_RECEIVED',
  'SYSTEM'
);

CREATE TABLE "notifications" (
  "id"          TEXT        NOT NULL DEFAULT gen_random_uuid()::text,
  "showroom_id" TEXT        NOT NULL,
  "user_id"     TEXT,
  "type"        "NotificationType" NOT NULL,
  "title"       TEXT        NOT NULL,
  "body"        TEXT        NOT NULL,
  "data"        JSONB,
  "is_read"     BOOLEAN     NOT NULL DEFAULT false,
  "read_at"     TIMESTAMP(3),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "notifications_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "notifications_showroom_id_fkey"
    FOREIGN KEY ("showroom_id") REFERENCES "showrooms"("id") ON DELETE CASCADE,
  CONSTRAINT "notifications_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "notifications_showroom_id_idx"     ON "notifications"("showroom_id");
CREATE INDEX "notifications_showroom_is_read_idx" ON "notifications"("showroom_id","is_read");
CREATE INDEX "notifications_created_at_idx"       ON "notifications"("created_at");

-- ── Subscription ──────────────────────────────────────────────
CREATE TYPE "SubscriptionStatus" AS ENUM (
  'ACTIVE',
  'EXPIRED',
  'CANCELLED',
  'TRIAL'
);

CREATE TABLE "subscriptions" (
  "id"              TEXT               NOT NULL DEFAULT gen_random_uuid()::text,
  "showroom_id"     TEXT               NOT NULL,
  "plan_name"       TEXT               NOT NULL DEFAULT 'STANDARD',
  "status"          "SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
  "started_at"      TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at"      TIMESTAMP(3)       NOT NULL,
  "renewed_by"      TEXT,
  "amount_paid"     DECIMAL(10,2),
  "payment_method"  TEXT,
  "notes"           TEXT,
  "created_at"      TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "subscriptions_showroom_id_fkey"
    FOREIGN KEY ("showroom_id") REFERENCES "showrooms"("id") ON DELETE CASCADE,
  CONSTRAINT "subscriptions_renewed_by_fkey"
    FOREIGN KEY ("renewed_by") REFERENCES "users"("id") ON DELETE SET NULL
);

CREATE INDEX "subscriptions_showroom_id_idx" ON "subscriptions"("showroom_id");
CREATE INDEX "subscriptions_status_idx"      ON "subscriptions"("status");
CREATE INDEX "subscriptions_expires_at_idx"  ON "subscriptions"("expires_at");
