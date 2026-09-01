-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'EXPIRED', 'REFUNDED', 'REJECTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_EXPIRING';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_EXPIRED';
ALTER TYPE "NotificationType" ADD VALUE 'SUBSCRIPTION_ACTIVATED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_SUBMITTED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_APPROVED';
ALTER TYPE "NotificationType" ADD VALUE 'PAYMENT_REJECTED';

-- AlterEnum
ALTER TYPE "SubscriptionStatus" ADD VALUE 'PENDING_PAYMENT';

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "approved_at" TIMESTAMP(3),
ADD COLUMN     "duration_months" INTEGER,
ADD COLUMN     "expiry_notified_days" INTEGER,
ADD COLUMN     "plan_id" TEXT,
ADD COLUMN     "price_amount" DECIMAL(10,2),
ADD COLUMN     "users_limit" INTEGER,
ALTER COLUMN "started_at" DROP NOT NULL,
ALTER COLUMN "started_at" DROP DEFAULT,
ALTER COLUMN "expires_at" DROP NOT NULL;

-- CreateTable
CREATE TABLE "plans" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "price_amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "duration_months" INTEGER NOT NULL,
    "users_limit" INTEGER NOT NULL,
    "features" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "showroom_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "plan_id" TEXT,
    "plan_name" TEXT NOT NULL,
    "plan_code" TEXT NOT NULL,
    "amount" DECIMAL(10,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'EGP',
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "provider" TEXT NOT NULL DEFAULT 'MANUAL',
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reference" TEXT,
    "proof_mime" TEXT,
    "proof_data" TEXT,
    "rejection_reason" TEXT,
    "reviewed_by" TEXT,
    "reviewed_at" TIMESTAMP(3),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "plans_code_key" ON "plans"("code");

-- CreateIndex
CREATE INDEX "payments_showroom_id_idx" ON "payments"("showroom_id");

-- CreateIndex
CREATE INDEX "payments_showroom_id_status_idx" ON "payments"("showroom_id", "status");

-- CreateIndex
CREATE INDEX "payments_subscription_id_idx" ON "payments"("subscription_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payments_reviewed_by_idx" ON "payments"("reviewed_by");

-- CreateIndex
CREATE INDEX "subscriptions_showroom_id_status_idx" ON "subscriptions"("showroom_id", "status");

-- CreateIndex
CREATE INDEX "subscriptions_plan_id_idx" ON "subscriptions"("plan_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_showroom_id_fkey" FOREIGN KEY ("showroom_id") REFERENCES "showrooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
