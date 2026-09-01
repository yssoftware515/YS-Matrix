# YS-Matrix — API Audit

**Status:** Discovery / Forensic Audit — Phase 1. Every endpoint enumerated from `backend/src/routes/` and verified against controllers (FACT).

Base path: `/api/v1` (`API_VERSION` env) · Envelope: `{success, message, data[, pagination|errors], timestamp}` + machine `.code` on errors (`utils/response.js`).

---

## 1. Endpoint Inventory (79 endpoints, 16 modules)

### 1.1 Auth — `/api/v1/auth` (authLimiter 10/15min on login + register-account ONLY)
| Method & route | Middleware | Controller fn | Notes |
|---|---|---|---|
| POST /login | authLimiter + validate(loginSchema) | login | cross-tenant email; license gate; creates refresh row; audit LOGIN |
| POST /refresh | validate(refreshTokenSchema) | refreshToken | atomic rotation; re-checks showroom/license; deletes token on rejection; replay race → 401 REFRESH_TOKEN_REUSED (never 500) |
| POST /forgot-password-request | forgotPasswordLimiter(3/15m) + validate | superAdminController.forgotPasswordRequest | public; anti-enumeration; invalidates prior tokens; emails SHA-256-hashed token |
| POST /reset-password | forgotPasswordLimiter + validate(resetPasswordSchema) | resetPasswordWithToken | public; one-time token; atomic update+revoke+burn |
| GET /me | A L T | getMe | self only |
| PATCH /me | A L T + validate(updateProfileSchema .strict()) | updateProfile | name/avatar_url only, never spreads body |
| POST /logout | A L T | logout | deletes refresh token; audit |
| POST /register-account | authLimiter + validate(registerAccountSchema) | registerAccount | public self-registration; OWNER + TRIAL; no tokens issued |
| POST /register | A L T + validate(registerSchema) | register | OWNER/SUPER_ADMIN only; OWNER→STAFF only; SUPER_ADMIN forbidden |
| PUT /change-password | A L T + validate(changePasswordSchema) | changePassword | revokes all refresh tokens |

(A=authenticate, L=checkLicense, T=tenantGuard — router-level at auth.routes.js)

> Phase 3 (P3-A): the auth limiter was moved OFF the `/auth` prefix mount onto
> the two anonymous credential endpoints (login, register-account) — /refresh,
> /me, /logout, /change-password no longer consume the brute-force budget.

### 1.2 Customers — `/api/v1/customers` (A L T O at router; O=ensureOnboarded)
GET / · GET /:id · POST / · PUT /:id — any authenticated
DELETE /:id · PATCH /:id/reactivate — **ownerOnly**

### 1.3 Sales — `/api/v1/sales` (A L T O)
GET /summary · GET /overdue · GET /upcoming · GET / (V query) · GET /:id · POST / (V) · PATCH /:id/cancel (**ownerOnly**) · PATCH /installments/:installment_id/pay (V)

### 1.4 Inventory — `/api/v1/inventory` (A L T O)
GET / · GET /stats · GET /low-stock · GET /:id · POST / (V) · POST /bulk (max 100) · PUT /:id (V)
DELETE /:id · PATCH /:id/reactivate — **ownerOnly**

### 1.5 Suppliers — `/api/v1/suppliers` (A L T O)
GET / · GET /stats · GET /:id · GET /:id/payments · POST / · PUT /:id · POST /:id/payments
DELETE /:id · PATCH /:id/reactivate — **ownerOnly**

### 1.6 Showrooms — `/api/v1/showrooms` (A T + superAdminOnly router-wide; no checkLicense)
GET / · POST / (creates showroom + subscription + OWNER atomically) · PUT /:id · GET /:id/stats

### 1.7 Invoices — `/api/v1/invoices` (A L T)
GET /:id · GET /:id/print (HTML)

### 1.8 Analytics + Expenses — `/api/v1/analytics` (A L T O; 7 GETs with cacheResponse 60s)
GET /dashboard · GET /net-profit · GET /revenue-chart · GET /monthly · GET /top-items · GET /profit-breakdown · GET /inventory
GET /expenses · POST /expenses · PUT /expenses/:id · DELETE /expenses/:id (**ownerOnly**)

### 1.9 Notifications — `/api/v1/notifications` (A L T)
GET / · GET /unread · PATCH /read-all · PATCH /:id/read · DELETE /old (**ownerOnly**)

### 1.10 Activity — `/api/v1/activity` (A L T + router-wide **ownerOnly**)
GET / (paginated, filters) · GET /filters · GET /summary · GET /:entity/:id (entity allow-list)

### 1.11 Subscriptions — `/api/v1/subscriptions` (A T)
GET /current (L) · GET /history (L) — any
GET /all · GET /summary · POST /renew — **superAdminOnly** (renew = single license write path)

### 1.12 Licenses — `/api/v1/licenses` (A T)
GET /status — any · GET /all · POST /renew — **superAdminOnly**

### 1.13 Search — `/api/v1/search` (A L T O)
GET /?q= (min 2 chars) — limited 5 per entity across inventory/customers/suppliers/sales

### 1.14 Onboarding — `/api/v1/onboarding` (A L T)
GET /status · PATCH / (OWNER|SUPER_ADMIN in controller)

### 1.15 SuperAdmin — `/api/v1/superadmin` (superAdminLimiter → A → tenantGuard-skip-for-SA → superAdminOnly; sensitiveOpsLimiter on 3 ops)
| Method & route | Extra | Function |
|---|---|---|
| GET /system-stats | | superadmin.analytics.getSystemStats (17 parallel aggregates) |
| GET /showrooms | V query | getAllShowroomsGlobal |
| POST /showrooms/:id/impersonate | **sensitiveOpsLimiter** | impersonateShowroom (30m access-only token) |
| GET /users | V query | getAllUsers |
| GET /users/:id | | getUserById |
| POST /users | **sensitiveOpsLimiter** + V | createUserForShowroom (OWNER/STAFF only) |
| PATCH /users/:id | V | updateUser (blocks editing SUPER_ADMIN, blocks assigning SUPER_ADMIN) |
| GET /password-reset-requests | | getPendingResetRequests (audit rows, 7d) |
| POST /reset-user-password | **sensitiveOpsLimiter** + V | resetUserPassword (blocks resetting SUPER_ADMIN) |

### 1.16 Infra
- GET /health — public liveness + version + env
- GET /api/cron/daily-notifications — public route, **Bearer CRON_SECRET required** (exact-match; 500 if secret unset); runs daily scans

---

## 2. Validation Coverage (FACT — `backend/src/validations/`)

- All route inputs are zod-validated (`validate()` middleware); query params on list endpoints; params on activity entity-history.
- Strongest schemas: `createSaleSchema` (superRefine: installment fields required when INSTALLMENT, down_payment < total, future first_due_date, no duplicate inventory items); `.strict()` + refine on profile/update-user.
- Password rules are enforced backend-side at controller level too (8–128; bcrypt rounds 12).
- **Pagination limits are universal** (page≥1, limit 1–100 default 15, `utils/pagination.js`) — no unbounded list endpoint (verified per service).

## 3. Business Logic Location (FACT)

- Money math & stock: `services/sales.service.js` (transactional)
- Supplier balance: `services/supplier.service.js` (transactional, overpayment rejected)
- Inventory rules: `services/inventory.service.js`
- License/subscription: `services/subscription.service.js` (+ license/controller)
- Notifications: `services/notification.service.js`
- Analytics: `services/analytics.service.js`
- **Exception:** `expense.controller.js` contains inline Prisma CRUD (no service layer) — minor architectural inconsistency (LOW)

## 4. Destructive & Sensitive Endpoints Review (FACT)

| Endpoint | Risk posture |
|---|---|
| DELETE customers/suppliers/inventory | Soft-delete only (is_active flip); ownerOnly; audit logged |
| PATCH sales/:id/cancel | ownerOnly; fail-closed re-check of paid installments inside tx; stock restored; audit |
| POST /subscriptions/renew, /licenses/renew, PUT /showrooms/:id | superAdminOnly; single write path resetting `license_warning_sent_days` |
| POST /superadmin/users, PATCH /users/:id, /reset-user-password | superAdminOnly + sensitive limiter (PATCH only superAdminLimiter — noted LOW); audit with target showroom |
| POST /showrooms/:id/impersonate | superAdminOnly + sensitive limiter; immutable 30m token; audit |
| POST /inventory/bulk | max 100 items; validation per item |
| GET /invoices/:id/print | **HTML with unescaped DB values** (see Security Audit — stored XSS surface) |

## 5. Error Behavior (FACT)

- Uniform shape with `.code`: VALIDATION_ERROR(400), UNAUTHORIZED(401), INSUFFICIENT_ROLE/FORBIDDEN(403), NOT_FOUND(404), CONFLICT(409), RATE_LIMITED(429), SERVER_ERROR(500), CROSS_TENANT_BLOCKED(403), LICENSE_EXPIRED/SHOWROOM_INACTIVE/ONBOARDING_REQUIRED(403 with redirect)
- Global error handler: raw `err.message` only when NODE_ENV exactly `development`; fail-closed generic otherwise (index.js:159-180)
- Audit failures never break responses (audit.middleware "never throws")

## 6. Rate Limiting Summary (FACT)

Global 300/15min (all, env-tunable); Auth 10/15min (login + register-account only — Phase 3 P3-A); forgot/reset 3/15min (env-tunable, prod default); superadmin router 30/15min; sensitiveOps 10/15min. Cron endpoint: secret-gated, not rate-limited (by design). Frontend analytics endpoints cached 60s in-memory.

## 7. Notable API Observations

1. **No pagination on expense list?** Verified: `getAllExpenses` is paginated (analytics.routes/pagination util).
2. **Cron endpoint accepts GET and performs DB writes** — secret-gated; no CSRF concern due to Bearer requirement.
3. **Health endpoint discloses env + version** — informational, acceptable.
4. **register endpoint** is inside authed section — the only user-creation path for OWNER (matches design).
5. **`superAdminUpdateUserSchema` forbids role ADMIN-like values** — enumeration limits role atomicity (OWNER/STAFF only).
6. All cross-tenant lists (users, showrooms, subscriptions) are superadmin-only and rate-limited.
7. **API contract drift risk**: there is no OpenAPI spec; `lib/api.ts` hand-mirrors contracts (single source of truth is the code itself). Docs `structure.md` API map matches code (verified), with 2 exceptions noted in Documentation Audit.
8. Future-facing: 79 endpoints is small enough to generate an OpenAPI spec mechanically when time permits (RECOMMENDATION).