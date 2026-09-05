-- AlterTable: Add MFA / TOTP fields to users table
-- Batch 5 — P0-A: SUPER_ADMIN multi-factor authentication

ALTER TABLE "users" ADD COLUMN "totp_secret_encrypted" TEXT,
ADD COLUMN "totp_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "backup_codes" JSONB;
