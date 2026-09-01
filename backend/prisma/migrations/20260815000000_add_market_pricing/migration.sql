-- Phase C.7 — approved commercial model (Egypt 350 EGP/month + billing periods)
-- ADDITIVE ONLY: creates the market pricing catalog and snapshots the
-- billing period on subscription claims. No data is modified or deleted.

-- CreateTable
CREATE TABLE "market_pricing" (
    "id" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "billing_period" TEXT NOT NULL,
    "base_amount" DECIMAL(10,2) NOT NULL,
    "discount_percent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "market_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "market_pricing_market_currency_billing_period_key" ON "market_pricing"("market", "currency", "billing_period");

-- CreateIndex
CREATE INDEX "market_pricing_market_currency_is_active_idx" ON "market_pricing"("market", "currency", "is_active");

-- AlterTable (billing-period snapshot on subscription claims)
ALTER TABLE "subscriptions" ADD COLUMN "billing_period" TEXT;
