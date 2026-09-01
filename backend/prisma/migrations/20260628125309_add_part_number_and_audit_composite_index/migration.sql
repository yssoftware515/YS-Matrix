-- AlterTable
ALTER TABLE "inventory" ADD COLUMN     "part_number" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_showroom_id_created_at_idx" ON "audit_logs"("showroom_id", "created_at");
