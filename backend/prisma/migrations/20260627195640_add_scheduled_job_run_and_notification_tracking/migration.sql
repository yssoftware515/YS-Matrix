-- AlterTable
ALTER TABLE "installments" ADD COLUMN     "overdue_notified_at" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "showrooms" ADD COLUMN     "license_warning_sent_days" INTEGER;

-- CreateTable
CREATE TABLE "scheduled_job_runs" (
    "id" TEXT NOT NULL,
    "job_name" TEXT NOT NULL,
    "run_key" TEXT NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scheduled_job_runs_job_name_run_key_key" ON "scheduled_job_runs"("job_name", "run_key");
