-- AlterTable
ALTER TABLE "inventory" ADD COLUMN     "is_active" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "inventory_showroom_id_is_active_idx" ON "inventory"("showroom_id", "is_active");
CREATE INDEX "idx_inventory_active" ON "inventory" ("showroom_id") WHERE "is_active" = true;