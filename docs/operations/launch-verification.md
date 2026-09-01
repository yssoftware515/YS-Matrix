# Launch Verification Procedure (MIG-01)

Operator checklist for bringing a production environment from a fresh `prisma migrate deploy` to a first paying subscription. Run top-to-bottom; each step has a pass criterion.

Context: production DB is PostgreSQL on Neon; the migration runner is Prisma; the app runs on Vercel (deployment applies migrations) or a manual step below.

## 1. Apply pending migrations

```
cd backend
npm run db:migrate:prod      # prisma migrate deploy
```

Pass: output lists every migration as applied, no pending rows remain:
`prisma migrate status` → "Database schema is up to date!"

The migration required by Phase C.4 (login lockout) is `20260814000000_add_login_lockout`.

## 2. Verify plan catalog (SUB-01)

```
npm run db:seed:plans
```

Pass: `[PLAN-SEED] PASS — 3 plans (0 created, 3 already present)` on re-runs.

Then verify over the API (needs a valid access token; the endpoint is public for the self-service surface):

```
GET /api/v1/subscriptions/plans
```

Pass: `data` is an array of exactly 3 plans with stable ids `standard`, `pro`, `enterprise`, each with `price_amount`, `duration_months`, `users_limit`, `is_active: true`, non-null `features.items`.

### 2a. Plan pricing confirmation (operator decision — SUB-01 flagged)

The seed ships deterministic default prices (see `backend/src/utils/seed.plans.js` header comment — the repo contains no canonical price list). Before inviting real customers:

- Confirm the three prices/durations/users limits with the business owner.
- If a price differs, either edit the `PLANS` array in `seed.plans.js` for fresh environments, or update the row directly in the DB — re-running `db:seed:plans` NEVER overwrites operator-adjusted prices (documented skip behavior).

## 3. Verify self-service purchase flow end-to-end

1. `POST /api/v1/auth/register-account` with a test email → expect `account_status: "PENDING"`.
2. `POST /api/v1/auth/login` → `access_scope` normal (trial window).
3. `GET /api/v1/subscriptions/plans` → 3 plans (step 2).
4. `POST /api/v1/subscriptions/request` with `plan_code: "STANDARD"` + a valid payment proof (PNG/JPG/WEBP ≤ 2MB base64) → `PAYMENT_SUBMITTED`.
5. SuperAdmin panel → approve the payment → subscription becomes ACTIVE.
6. Showroom owner refreshes billing page → plan shown as current.

Pass: every step returns the documented success envelope; no 500s; payment proof never served outside owner/GLOBAL admins.

## 4. Verify money-out role separation (P1)

As a STAFF user (not OWNER), confirm each of these returns `403 INSUFFICIENT_ROLE`:

- `POST /api/v1/analytics/expenses`
- `PUT /api/v1/analytics/expenses/:id`
- `POST /api/v1/suppliers/:id/payments`

Pass: same requests with an OWNER token succeed (201/200).

## 5. Verify overdue lifecycle + audit (P1)

1. Create an INSTALLMENT sale with a first due date in the past.
2. Trigger the cron scan: `GET /api/cron/daily-notifications` with the header `Authorization: Bearer <CRON_SECRET>` (or wait for the Vercel schedule). The route is deliberately outside `/api/v1` (internal infra trigger — see `backend/src/index.js`) and requires the shared secret.
3. Pass:
   - sale status becomes `OVERDUE`
   - an `AuditLog` row exists with `action: 'SALE_MARKED_OVERDUE'` for that sale (visible in the SuperAdmin audit panel)
   - a second scan run creates NO duplicate audit row (idempotent).
4. Pay the overdue installment → sale returns to `ACTIVE` (or `COMPLETED` when fully paid).

## 6. Verify installments concurrency (P1)

Double-click / two-tab pay on the same installment:

Pass: exactly ONE payment succeeds; the second request returns `409` ("القسط مدفوع مسبقاً"); sale status is `COMPLETED` once fully paid; no duplicate paid rows.

## 7. Verify login lockout (N-1)

With a known user: 5 consecutive wrong passwords → login still returns the generic `INVALID_CREDENTIALS` message (anti-enumeration), and the correct password is ALSO rejected with the generic message until the lockout window (15 min, configurable in `backend/src/config/security.js`) expires.

Pass: SuperAdmin audit panel shows `LOGIN_FAILED` rows with `reason: 'ACCOUNT_LOCKED'` at the 6th attempt; a correct-password login after the window clears succeeds and resets the counter.

## 8. Verify password reset email audit (N-4)

Request a reset for a real address with a verified sender. Pass:

- email arrives with a working link;
- audit row `PASSWORD_RESET_REQUESTED` has `status: 'EMAIL_SENT'`.

With an unverified sender / no RESEND_API_KEY, the response stays generic, and the audit row records `status: 'EMAIL_SEND_FAILED'` (this is the visibility the panel needs to spot broken mail).

## 9. Verify sales list remaining balance (FIN-1)

Pass: `GET /api/v1/sales` rows for INSTALLMENT sales carry `remaining_amount` = sum of unpaid installments (server-computed); CASH rows carry `0`; the sales list page shows "متبقي:" only for INSTALLMENT sales.

## 10. Verify expense total (EXP-2)

Pass: `GET /api/v1/analytics/expenses?range=month` pagination object contains `total_amount` equal to the sum of the matching rows' amounts; the expenses page header total matches.

## 11. First real subscription smoke test

Only after steps 1-10 all pass: register a real dealer account, guide the owner through the first purchase, and confirm the SuperAdmin approval flow end-to-end on the production DB.

## References

- Plan seeding: `backend/src/utils/seed.plans.js`
- Lockout config: `backend/src/config/security.js` → `login.*`
- Overdue scan: `backend/src/services/notification.service.js` → `runOverdueInstallmentScan`
- Backup/restore: `docs/operations/backup-restore.md`
- Email verification: `docs/operations/email-verification.md`