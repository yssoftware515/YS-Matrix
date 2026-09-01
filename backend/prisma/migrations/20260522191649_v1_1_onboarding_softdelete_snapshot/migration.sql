-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "sale_items" ADD COLUMN     "chassis_number" TEXT,
ADD COLUMN     "color" TEXT,
ADD COLUMN     "engine_number" TEXT,
ADD COLUMN     "vehicle_model" TEXT;

-- AlterTable
ALTER TABLE "showrooms" ADD COLUMN     "is_onboarded" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "customers_showroom_id_is_active_idx" ON "customers"("showroom_id", "is_active");

-- CreateIndex
CREATE INDEX "suppliers_showroom_id_is_active_idx" ON "suppliers"("showroom_id", "is_active");
