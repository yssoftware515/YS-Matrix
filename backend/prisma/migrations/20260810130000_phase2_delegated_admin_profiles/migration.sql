-- Phase 2 — Delegated Platform Administration (Slice 1)
-- Additive, nullable profile override on users.
--
-- users.profile_id IS NULL  → legacy role-based resolution (OWNER/STAFF),
--                             unchanged behavior.
-- users.profile_id SET      → effectiveAuthorization resolves the assigned
--                             profile row (delegated platform administrator).
-- SUPER_ADMIN is NEVER represented here — protected system authority.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "profile_id" TEXT;

-- CreateIndex
CREATE INDEX "users_profile_id_idx" ON "users"("profile_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_profile_id_fkey" FOREIGN KEY ("profile_id") REFERENCES "profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;