# Secret Rotation & Operations Runbook (YS-MATRIX)

Scope: every credential used by the YS-MATRIX production stack.
Applies to YS-SOFTWARE operators only. Never print, commit, or paste
actual secret values anywhere — including in issue trackers, chat, or
this repository.

Context facts (verified C.9/C.10):

- Production secrets live in `backend/.env` (gitignored, on the
  company-controlled dev box) and must ALSO exist in the Vercel
  project environment store for the deployed app (the deployment
  reads env from Vercel, not from the local file).
- Only `.env.example` is tracked in git (backend + frontend).
- Production DB: Neon PostgreSQL (`neondb`), connection via
  `DATABASE_URL` in the same env stores.

## 1. SUPER_ADMIN credential rotation

1. Log in as SUPER_ADMIN (or use the pending-approval flow) and issue
   a password reset to the `SUPER_ADMIN_EMAIL` address:
   `POST /api/v1/auth/forgot-password` → email link (must arrive from
   the verified sender; see email-verification.md).
2. Follow the link and set the new password (min 8 chars, any case).
3. Update `SUPER_ADMIN_PASSWORD` in `backend/.env` AND in the Vercel
   environment store with the same new value, so local scripts
   (seed.superadmin.js) stay in sync with the deployment.
4. Verify: login with the new password → `200`; old password →
   generic `401 INVALID_CREDENTIALS`; audit rows show
   `PASSWORD_RESET_REQUESTED` + `LOGIN_SUCCESS`.
5. All previously issued access/refresh tokens are invalidated
   (refresh tokens are revoked on reset — verified by the integration
   suite "password reset rotates creds and revokes refresh tokens").

Trigger: at least every 90 days, after any suspected exposure, or
before/after any operator handoff.

## 2. JWT secrets rotation

The app uses `JWT_SECRET` (access tokens, 15 min TTL) and
`JWT_REFRESH_SECRET` (refresh tokens, 7 days, hashed at rest, atomic
rotation on use — auth.controller.js).

1. Generate new values (e.g. `openssl rand -hex 64` twice).
2. Update both in `backend/.env` and the Vercel environment store.
3. Deploy (Vercel Git integration auto-deploys on push, or use the
   Vercel dashboard "Redeploy").
4. Impact: ALL sessions are logged out on the next refresh (old
   refresh JWTs no longer verify; access tokens expire within 15
   minutes). This is the intended "log everyone out" semantics.
5. Verify with one test login → `200`, then `POST /auth/refresh` →
   `200` with a new token pair.

Trigger: every 180 days, or on any suspected compromise.

## 3. CRON_SECRET rotation

1. Generate a new value (`openssl rand -hex 32`).
2. Update in `backend/.env` and the Vercel environment store, then
   redeploy.
3. Verify: `GET /api/cron/daily-notifications` with the OLD secret →
   `401`; with the NEW secret → `200`; with no secret → `401`.
4. Vercel Cron jobs read the secret from the environment store, so a
   plain redeploy is sufficient — no vercel.json edit needed.

Trigger: every 180 days, or on any suspected exposure (e.g. secret
seen in logs or PRs).

## 4. RESEND_API_KEY rotation

1. Resend Dashboard → API Keys → create a new key → delete the old
   one AFTER the new key is confirmed working.
2. Update `RESEND_API_KEY` in `backend/.env` and the Vercel
   environment store; redeploy.
3. Verify: trigger one controlled password reset for a registered
   email whose inbox you control → audit row
   `PASSWORD_RESET_REQUESTED` shows `status: EMAIL_SENT`, email
   arrives within ~30 s from the verified sender.
4. The email client is lazy-constructed (email.service.js): a bad key
   fails only the single sending request (`EMAIL_SEND_FAILED` audit
   row) and never crashes the server.

Trigger: every 180 days, on suspected exposure, or when Resend
notifies of key issues.

## 5. Production environment variable management

- Single source of truth: `backend/.env` (local, gitignored) AND the
  Vercel project env store must stay in sync. Vercel is
  authoritative for the deployed app.
- Before changing any env var: verify the target is the correct
  project (`ys-matrix-backend`), not a test project.
- After any change: redeploy and verify `/health` reports
  `env: "production"` and the affected surface (CORS, pricing,
  email, cron) behaves as expected.
- Never put secrets in `.env.example`, commits, logs, or reports.
- `DATABASE_URL`: the local dev-box `.env` points at production
  Neon; the test suite is protected by `scripts/test-db-guard.js`
  which REFUSES to run against any non-localhost URL (self-test
  PASS verified C.9).

## 6. Emergency credential revocation

Scenario A — suspected account compromise:
1. Rotate the affected user's password immediately via the reset
   flow (or `db:seed:admin` upsert with a fresh password — never
   print it).
2. Refresh tokens are revoked on password reset; access tokens die
   within 15 min.

Scenario B — suspected secret leak (JWT/CRON/Resend/DB):
1. Rotate the leaked secret per sections 2-4 (all sessions end).
2. If the DB connection string leaked: rotate the Neon DB password
   in the Neon Console, update `DATABASE_URL` in both stores, and
   redeploy. Existing pooled connections drop on redeploy.
3. Review audit logs (`PASSWORD_RESET_REQUESTED`, `LOGIN_FAILED`,
   admin actions) in the SuperAdmin panel for anomalies; if
   super-admin activity is suspected, rotate the SUPER_ADMIN
   credential (section 1) and consider Neon PITR restore
   (backup-restore.md scenario B) if data tampering is suspected.

Scenario C — developer/operator departure:
1. Rotate SUPER_ADMIN password + JWT secrets + CRON_SECRET +
   RESEND_API_KEY (sections 1-4) — one pass covers all.

## 7. Deployment rollback procedure

- The deployment is via Vercel Git integration: every push to
  `main` of `yehiahwary0-oss/YS-matrix-backend` /
  `yehiahwary0-oss/YS-matrix-frontend` auto-deploys.
- Rollback options (Vercel Dashboard → Project → Deployments):
  1. Promote a previous healthy deployment ("Promote to
     Production") — fastest; no code change needed.
  2. Or `git revert` the bad commit and push (creates a new
     deployment).
- DB schema rollback: NEVER hand-roll DDL. Follow backup-restore.md
  — restore is "point the app at a pre-migration branch" or PITR,
  then `prisma migrate status` to confirm consistency.
- Pre-requisite for any release: manual Neon snapshot branch
  (`neonctl branches create --name pre-release-YYYY-MM-DD
  --type read_only`) per backup-restore.md §2, kept ≥ 1 week.
- Verify after rollback: `/health` → 200 `env:production`,
  pricing endpoint returns the approved catalog, one login works.

## 8. Operator checklist before Customer #1 (C.9/C.10 remaining gates)

1. Resend: verify sending domain in dashboard + DNS, set
   `RESEND_FROM_EMAIL` to the verified-domain address in the Vercel
   env store; run the controlled email E2E (email-verification.md §3).
2. Neon: `neonctl branches list` → confirm daily backups + paid plan
   with PITR; create the read-only snapshot branch before launch
   (backup-restore.md §2).
3. Tenant + subscription smoke on an explicitly authorized test
   tenant with a real controlled payment (launch-verification.md
   §3-11) — amount must resolve from `market_pricing.final_amount`.
4. Execute this runbook's rotations (or schedule them) and record
   completion here.

## Non-negotiable

- No secret value ever printed, committed, or pasted — this file
  intentionally contains no values.
- Any rotation that cannot be executed safely → mark
  OPERATOR-PENDING and record the blocker; never fake a rotation.
- Changes to secrets must be reflected in BOTH `backend/.env` and
  the Vercel environment store before the next deploy.