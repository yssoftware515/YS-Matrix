-- Phase C.4 — Login Lockout (N-1)
-- Additive, non-nullable-with-default columns on users.
--
-- users.failed_login_attempts  → consecutive wrong-password attempts since
--                                 the last successful login (default 0).
-- users.locked_until           → non-null while the account is temporarily
--                                 locked; login is rejected until the window
--                                 passes. NULL = not locked.
--
-- Reset on: successful login, password change, password reset with token.
-- Threshold/window live in backend/src/config/security.js → login.*.
-- No existing rows are affected (defaults apply); zero-downtime additive.

-- AlterTable
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "users" ADD COLUMN "locked_until" TIMESTAMP(3);