# YS-Matrix — Architecture Authority (Target State)

**Status:** Phase 2 architecture authority — BUILD-approved, documentation-only (no application code modified).
**Updated:** Phase 2 (post Phase 1 audit).
**Supersedes:** The Phase 1 forensic record as the *planning* source of truth; the forensic record itself is preserved verbatim in Appendix A (nothing deleted).
**Labels:** `CURRENT FACT` (verified from source) · `PROPOSAL` (planned design) · `RECOMMENDATION` · `OPEN DECISION` · `RISK` · `ASSUMPTION` · `DEFERRED` · `CONTRADICTION`.
**Phase 1 references:** `docs/YS_MATRIX_AUTHORIZATION_AUDIT.md`, `docs/YS_MATRIX_API_AUDIT.md`, `docs/YS_MATRIX_SECURITY_AUDIT.md`, `docs/YS_MATRIX_DISCOVERY_REPORT.md`, `docs/YS_MATRIX_DATABASE.md` — repeat analysis lives there, not here.

---

# Part A — Current Architecture (condensed summary)

`CURRENT FACT` — verified in Phase 1. Detail in Phase 1 docs.

| Area | Current state |
|---|---|
| Stack | Express 4 + Prisma 5 + PostgreSQL (unified backend); Next.js 15 SPA frontend (Phase 4A upgrade from 14); both on Vercel |
| Auth | Access JWT 15m + rotating DB-persisted refresh token 7d; identity (user/role/showroom) re-resolved from DB on every request, never trusted from JWT alone |
| Roles | DB enum `SUPER_ADMIN / OWNER / STAFF`, single role per user; checks centralized in `backend/src/middleware/roles.middleware.js` (`requireRole`, `requireMinRole`, `ownerOnly`, `superAdminOnly`); only 5 SUPER_ADMIN boundary guards outside that file (`auth.controller.js`, `superadmin.controller.js`) |
| Tenant isolation | 3 layers: `tenantGuard` middleware (tenant id from DB record only, client-supplied mismatch → 403) + Prisma `$allOperations` showroom_id injection for all non-`GLOBAL_MODELS` models + fail-closed `TenantContextError` when no context |
| Tenant model | `Showroom` is the tenant root: `license_expiry` + `subscriptions` keyed by showroom_id; all operational data (inventory, sales, customers, installments, audit logs, notifications) is showroom-scoped |
| License | `showrooms.license_expiry` (source of truth) + subscription rows; single renewal write path; cron warning at 30/7/1 days |
| Impersonation | SUPER_ADMIN-only; 30-min access-only token (no refresh), target must be active OWNER of an active showroom; audited; sensitive-ops limited |
| MFA | **None** (no code exists) |
| Support surface | **None** in product; support is external email (`cantactys@gmail.com`) |
| Platform administration | **Single SUPER_ADMIN account only**; no delegated admins; no permission or scope concepts anywhere |
| Tests / CI / VCS | No tests and no CI existed. `CONTRADICTION` (corrected, Phase 0): the Phase 1 "zero git history" finding applied only to the outer wrapper repo — `backend/` and `frontend/` are each their own git repo with full history and GitHub remotes (YS-matrix-backend / YS-matrix-frontend). Phase 0 established the outer baseline commit and a `node:test` regression suite (41 tests) |

The three-layer tenant isolation and DB-resolved identity are retained intact as the foundation of the target design.

---

# Part B — Target Authorization Architecture

## B.1 Authorization pipeline

```
Request
  → Authentication        (existing authenticate, jwt verify + DB identity load — unchanged)
  → Identity Resolution   (DB re-read, disabled-account check — unchanged)
  → Permission Resolution (central resolver: user → role/profile → permission set)
  → Scope Resolution      (resolver: scope type + scope object id, from assignment/DB — never client input)
  → Authorization Decision (single resolver entry — replaces scattered role comparisons)
  → Controller / Service  (existing validation flows — unchanged)
  → Scoped Database Query (existing tenant extension — unchanged)
```

Principles:
- **Backend is authoritative**; frontend consumes a returned `permissions[]` only for UX (buttons, nav, empty states) — never a security boundary.
- **One decision point.** The resolver extends `roles.middleware.js` (`CURRENT FACT` — role checks are already centralized there) rather than spreading `if (role === ...)` across routes. Route files stop comparing roles themselves.

## B.2 Permission model — `resource:action`

`PROPOSAL` — no permission code exists today until Phase 1 implements it.

- Identifier format: `resource:action`, e.g. `clients:read`, `showrooms:update`, `licenses:renew`, `audit:read`, `users:read`, `support:manage`.
- **Scope is a separate dimension** (B.3), never encoded in the identifier.
- **No wildcard permission entries** (`clients:*`) in the catalog. Wildcard notation is allowed only as profile shorthand and is explicitly notated as such in docs — never enforced as semantics.
- **Granularity rule (anti-explosion):** only permissions that change a decision are catalogued. Phase 1 catalogs only the **platform-administration** surface (clients/showrooms/users/licenses/audit/support). Tenant-domain ERP operations (inventory, sales, customers, installments) keep today's OWNER-vs-STAFF role split through the compatibility layer (B.4/B.7) — no ERP-domain permission explosion.
- Initial catalog (PROPOSAL): `clients:read, clients:create, clients:update, clients:suspend, showrooms:read, showrooms:create, showrooms:update, users:read, users:create, users:update, users:disable, licenses:read, licenses:renew, audit:read, support:manage` — all GLOBAL-scoped.

## B.3 Scope model

`PROPOSAL` — scopes exist implicitly today (`showroom_id`-scoped everything); no scope *enum* is created in Phase 1. Scope is a column on the role assignment (`scope_type` + optional `scope_id`).

| Scope | Meaning today | Implemented when |
|---|---|---|
| `SHOWROOM` | Tenant boundary — the actual data scope of every tenant user | Now — it already exists (`tenantGuard` + injection); formalized in the assignment model |
| `SELF` | Personal resources (own profile, own notifications) | Now — patterns already exist in auth/profile endpoints; formalized with the resolver |
| `GLOBAL` | Platform administration (clients, showrooms, users, licenses, audit, support) | Wire format reserved; effective permissions for it only once delegated platform admins land (Phase 2) |
| `CLIENT` | Client-level scope above showrooms | **DEFERRED** — depends entirely on the deferred Client entity (B.9); no enum, no columns now |

The resolver never trusts client-supplied scope input; scope resolves exclusively from the user's DB assignment, consistent with `tenantGuard` (`CURRENT FACT`).

## B.4 Roles — no role explosion

`PROPOSAL` + `CURRENT FACT`.

- **No new enum roles** (`ADMIN`, `ADMIN_LEADER`, `ADMIN_MANAGER`, `ADMIN_SUPPORT`, `ADMIN_CLIENTS`) are created. Platform administration is expressed as **permission-defined profiles** (B.8).
- **SUPER_ADMIN** remains a DB enum value (`CURRENT FACT`) and is elevated to a **protected system authority** (B.5) — it is a built-in boundary, not a permission bundle, never assignable via grants.
- **OWNER / STAFF** remain valid tenant roles throughout the first migration via a **compatibility mapping** (B.7): the resolver treats legacy enum values as built-in permission sets (`owner` = full tenant domain; `staff` = today's staff rights). No rewrite of tenant route authorization logic in Phase 1.

## B.5 SUPER_ADMIN security invariants

`PROPOSAL` — backend-enforced, not UI-enforced:

1. No administrator (any permission set) can create a SUPER_ADMIN.
2. No administrator can promote themselves.
3. No administrator can grant SUPER_ADMIN to another user.
4. No administrator can modify a SUPER_ADMIN's security authority.
5. API manipulation cannot bypass 1–4 (checks are server-side in the grant/role-change service, inside the same transaction as the write).
6. Frontend manipulation cannot bypass 1–4 (frontend is never authoritative).

Model: the existing 5 SUPER_ADMIN guards outside `roles.middleware.js` (`auth.controller.js`, `superadmin.controller.js` — `CURRENT FACT`) are the proven pattern; the new grant/role-change service generalizes them. Every attempt, including rejected ones, is audited.

## B.6 No privilege amplification

`PROPOSAL` — core rule: **an actor cannot grant permissions or scopes exceeding what they are authorized to delegate.** All enforced server-side in one transactional grant service:

1. **Permission subset validation** — every granted permission must exist in the creator's own effective set (or creator is SUPER_ADMIN).
2. **Scope containment** — granted scope must be within the creator's own scope (GLOBAL ⊇ SHOWROOM ⊇ SELF; a SHOWROOM-scoped actor cannot grant GLOBAL).
3. **Role boundary** — only SUPER_ADMIN can create platform profiles or assign platform roles; administrators assign only roles strictly below their own authority.
4. **Race protection** — check-and-write in a single transaction with a pessimistic lock keyed on the target user (or optimistic version column on the assignment).
5. **Audit** — every grant/change logs actor, target, before/after, scope.

## B.7 OWNER/STAFF compatibility & storage direction

`PROPOSAL` — migration strategy, single decision engine (no dual engines):

- **Additive tables** (Phase 1): `permissions` (catalog), `roles` (profiles with `kind`: `SYSTEM | PLATFORM | TENANT`; seeded SUPER_ADMIN boundary row + legacy `owner`/`staff` rows), `role_permissions` (join), `user_role_assignments` (user ↔ role + `scope_type` + `scope_id`).
- `users.role` enum (`CURRENT FACT`) is **not dropped**: during Phase 1 it remains the source for tenant identity; the resolver maps it to legacy permission sets. Existing routes, tokens, and sessions keep working (identity is already DB-resolved per request — `CURRENT FACT`).
- **Explicitly excluded:** `user_permissions` direct overrides (no proven need — defer), multi-role combos (single assignment per user), permission DSL, generic enterprise frameworks.
- Rollback of Phase 1 is a feature flag: resolver middleware toggle restores the previous `requireRole` behavior; schema additions are additive and harmless.

## B.8 Platform administration — permission-defined

`PROPOSAL` — target shape:

- **SUPER_ADMIN** (the only GLOBAL authority): creates/removes platform administrators, assigns permissions and scopes, manages clients/showrooms/users, platform settings, reads audit; everything audit-logged.
- **Platform administrator** = a permission-defined profile (role row bundling granular permissions, e.g. `Platform Client Admin` = `clients:read/create/update/suspend` + `showrooms:read/create/update` + `users:read`; `Platform Support Admin` = `support:manage` + `clients:read` + `showrooms:read` + `users:read` + `audit:read`).
- **API:** new admin-management endpoints (create admin, assign permissions, limit scopes, disable, list, remove) — superadmin-surface, `VERIFY BEFORE IMPLEMENTATION` for exact placement beside `superadmin.controller.js`.
- **Frontend:** new `/admin/*` route group (`PROPOSAL` path) with permission-aware rendering driven by backend-returned permissions; loading/error/empty states; never a security gate. Legacy `/dashboard/superadmin/*` preserved until migration (OPEN DECISION — redirect vs. migrate, low risk).

## B.9 Showroom is the tenant boundary; Client entity deferred

`CURRENT FACT` + `DEFERRED`:

- **Now:** `Showroom` remains the tenant root — license, subscriptions, users, and all operational data stay showroom-scoped; nothing about the current schema or isolation changes for a hypothetical Client.
- **Client entity:** **DEFERRED** — introduce only when a concrete requirement exists that cannot be served safely without it (none today). The scope model is additive (`CLIENT` scope row + optional `client_id` later) without rewiring the resolver, so deferral costs nothing architecturally. No license/subscription/user-schema/isolation redesign in this phase.

## B.10 Minimal YS-Matrix support architecture

`PROPOSAL` — smallest correct flow:

```
In-app contact/issue form (dashboard)
  → structured context: Product: YS-Matrix · Category · Module · Version · Message
  → product-stamped structured email via existing Resend integration (CURRENT FACT — email service exists)
  → shared inbox (existing support email, CURRENT FACT)
```

- Product identification embedded in content/prefix — no per-product infrastructure.
- **No ticket system** (DEFERRED until volume justifies).
- **No automatic inclusion of tenant/customer data** (no national IDs, sales, balances, tokens) — privacy control; optional opt-in reference fields only.
- Alignment with the wider YS_PLATFORM/YS_MATRIX/YS_CARE product family: uniform product-stamped contact format; no shared backend.

## B.11 Implementation-relevant security controls

Each control maps to a threat already present in the Phase 1 authorization/security audits; only controls that change what engineers implement are listed.

| Threat / weakness | Concrete control (target) |
|---|---|
| Privilege escalation (incl. self-promotion) | B.5 invariants + B.6 transactional grant checks + SUPER_ADMIN hard-reject; every attempt audited |
| Tenant breakout / IDOR-BOLA | Existing 3-layer isolation untouched; resolver never widens scope; GLOBAL-scoped admin queries still require explicit filters (existing `baseClient` discipline) |
| SUPER_ADMIN compromise (single point of failure) | Phase 4: MFA (TOTP + recovery codes) mandatory-or-step-up for SUPER_ADMIN; impersonation gated behind step-up |
| Impersonation abuse | Keep 30-min access-only model; harden Phase 4: step-up to start, session nonce, explicit in-UI state, no nested impersonation, sensitive ops restricted while impersonating |
| Session theft | Existing rotating refresh + DB re-resolution retained (`CURRENT FACT`); unchanged |
| Stale authorization from caching | **No permission caching initially** — resolver reads identity + assignment from DB per request (no cache). Re-evaluate only if profiling demands it |
| Race on grant/promotion | Single transaction + lock/version (B.6.4) |
| Frontend bypass | Backend authoritative; existing rate limiters applied to new admin endpoints |
| Orphaned assignments | FK constraints, cascade cleanup on user disable/delete; reconcile check in audit views |

## B.12 Non-goals in this phase (anti-over-engineering)

No microservices, no event bus, no policy DSL, no generic cross-product authorization framework, no distributed caching, no ticketing system, no billing redesign, no Client entity, no new domain entities beyond the four additive admin tables — none are justified by repository evidence today.

---

# Appendix A — Phase 1 Forensic Record (preserved verbatim)

**Do not delete.** The following is the original Phase 1 architecture record, kept byte-for-byte as historical evidence. Where it conflicts with Part B, Part B is the approved target and the difference is intentional (`DEFERRED` / `PROPOSAL` noted there).

(Original Phase 1 content follows.)

---

# YS-Matrix — Architecture & Data Flow

**Status:** Discovery / Forensic Audit — Phase 1. Evidence-based; no application code modified.
**Legend:** FACT / INFERENCE / UNKNOWN / RISK / RECOMMENDATION (see `YS_MATRIX_DISCOVERY_REPORT.md`).

---

## 1. System Topology

```
Browser (Next.js SPA, client-rendered)
   │  HTTPS
   ▼
Vercel Frontend  (ys-matrix-frontend.vercel.app)
   │  axios → NEXT_PUBLIC_API_URL (https://ys-matrix-backend.vercel.app/api/v1)
   ▼
Vercel Backend   (one Express function: src/index.js via @vercel/node — backend/vercel.json)
   │  /health, /api/v1/*, /api/cron/*
   ▼
PostgreSQL (Prisma 5, Neon — INFERENCE from deployment; provider: postgresql)
   │
   ├─ Resend (transactional email: password reset only — services/email.service.js)
   └─ Vercel Cron → GET /api/cron/daily-notifications (bearer CRON_SECRET — cron.routes.js)
```

FACTS: `frontend/.env.local` → `NEXT_PUBLIC_API_URL=https://ys-matrix-backend.vercel.app/api/v1`; `backend/vercel.json` routes everything to `src/index.js` with `@vercel/node`; `backend/vercel.json` defines one cron: `/api/cron/daily-notifications` at `0 8 * * *`.

## 2. Request Lifecycle (core middleware pipeline)

For all tenant resource routes the pipeline is (FACT — route files):

```
globalLimiter (100 req/15min, index.js:87-101)
   → helmet (CSP/HSTS/nosniff/xss-filter/frameguard, index.js:64-72)
   → CORS (origin allow-list from ALLOWED_ORIGINS, index.js:75-84)
   → body parsing (10mb limit)
   → morgan logging (skipped in 'test')
   → [router-level]
      authenticate  →  checkLicense  →  tenantGuard  →  [ensureOnboarded]  →  validate()  →  controller
```

### Pipeline stages (FACT)

1. **`authenticate`** (`middleware/auth.middleware.js:30`) — verifies `Authorization: Bearer <accessToken>` with `JWT_ACCESS_SECRET`; reloads the user from DB via `baseClient` by `decoded.userId`; rejects disabled accounts (`ACCOUNT_DISABLED`); rejects non-SuperAdmin without showroom; sets `req.user`, `req.showroomId`, `req.impersonatedBy`.
2. **`checkLicense`** (`middleware/license.middleware.js:21`) — SUPER_ADMIN bypasses; inactive showroom → 403 `SHOWROOM_INACTIVE`; expired → 403 `LICENSE_EXPIRED`; ≤ 7 days → warning headers `X-License-Warning/Days-Left/Expiry`, request allowed.
3. **`tenantGuard`** (`middleware/tenant.middleware.js:57`) — resolves `showroomId` **exclusively** from the user's own DB record (never client input); any client-supplied `showroom_id` that differs → 403 `CROSS_TENANT_BLOCKED` (applies to every role, including SUPER_ADMIN — the legacy query/body backdoor was removed, header lines 3-34); then runs the rest of the request inside `AsyncLocalStorage` (`tenantStorage.run`).
4. **`ensureOnboarded`** (`middleware/onboarding.middleware.js:21`) — SUPER_ADMIN exempt; un-onboarded showroom → 403 `ONBOARDING_REQUIRED` with `redirect: /dashboard/onboarding`. Not applied to auth, onboarding, invoice, notification, subscription, license, showroom, superadmin, cron routes.
5. **`validate(schema)`** (`middleware/validate.middleware.js:45`) — zod parse of body/query/params; replaces request payload with the parsed (coerced) result; 400 `VALIDATION_ERROR` on failure.

## 3. Tenant Isolation — Three Independent Layers (FACT)

1. **Middleware layer** — `tenantGuard` rejects any client-supplied showroom_id mismatch; injects `showroomId` in AsyncLocalStorage.
2. **Query layer** — `config/database.js` exports a Prisma client extended via `$allOperations` that injects `showroom_id` into reads (`where`) and writes (`data`/`create`/`createMany`/`upsert`) for every model **not** in `GLOBAL_MODELS`:
   `Showroom, RefreshToken, AuditLog, Installment, SaleItem, SupplierPayment, ScheduledJobRun` (database.js:33-41).
   `user` was deliberately removed from GLOBAL_MODELS (privacy fix, v2.1).
3. **Fail-closed layer** — a scoped-model operation with no `showroomId` in context throws `TenantContextError` (500) instead of running unfiltered (v2.2, database.js:121-134, 156-158).

Deliberately cross-tenant paths use `baseClient` explicitly and are documented as such:
- Auth controller (email lookups, tokens) — `auth.controller.js`
- SuperAdmin control plane — `superadmin.controller.js`, `superadmin.analytics.js`, `showroom.controller.js`
- Subscription/license all-tenants views — `subscription.service.js` (`listAllSubscriptions`, `getSubscriptionSummary`), `license.controller.js` (`getAllLicenses`)
- Cron job scanners — `notification.service.js` (via `baseClient`)
- Invoice number generation — `utils/invoice.js` (`pg_advisory_xact_lock`)

RISK: the `baseClient` paths rely on careful manual `showroom_id` filters with **no mechanical safety net** — acknowledged in `showroom.controller.js:8-45`. A future editor mistake in those files could cross tenant boundaries silently. RECOMMENDATION: add a code-review checklist / wrapper that requires explicit filter presence for cross-tenant reads.

## 4. Data Flow — End-to-End Business Processes

### 4.1 Login
```
POST /api/v1/auth/login  → validate(loginSchema) → authController.login
  baseClient.user.findUnique(email) → inactive check → bcrypt.compare
  → license/showroom-active check (non-SuperAdmin)
  → JWT pair from {userId, showroomId, role}
  → refresh_token row persisted (raw token, expires 7d)
  → auditLog LOGIN (fire-and-forget)
  → 200 {user, accessToken, refreshToken}
```
(auth.controller.js:27-131)

### 4.2 Session renewal
`POST /auth/refresh` — verify JWT with refresh secret → look up stored token → check showroom still active & license valid (token deleted on rejection) → atomic rotate (delete + create in one `$transaction`) (auth.controller.js:200-308).

### 4.3 Sale creation (the core money flow)
```
POST /api/v1/sales  → sales.service.createSale
  single $transaction:
    validate items (1-50) against inventory (tenant-scoped reads)
    validate customer belongs to showroom
    compute profit = Σ(qty×(unit_price − cost_price)) − discount
    generate unique invoice number via advisory lock (INV-<SLUG3>-<YEAR>-<SEQ5>)
    create Sale + SaleItems (immutable snapshots: chassis/engine/color/vehicle_model)
    decrement inventory (qty 0 → SOLD)
    create installment schedule when INSTALLMENT
  post-commit: notifySaleCreated + low-stock alerts (never inside tx)
```
(sales.service.js; utils/invoice.js)

### 4.4 Cancel
`PATCH /sales/:id/cancel` (ownerOnly) — fail-closed inside tx: blocks INSTALLMENT sales with any paid installment; restores inventory; marks unpaid installments `SALE_CANCELLED` (sales.service.js).

### 4.5 Installment payment
`PATCH /sales/installments/:installment_id/pay` — ownership check `installment.sale.showroom_id !== showroomId → FORBIDDEN` (sales.service.js:476-478); marks paid; completes sale when none remain; recomputes ACTIVE/OVERDUE.

### 4.6 Daily cron
`GET /api/cron/daily-notifications` (or node-cron at 08:00) → `runDailyNotificationScans()` → overdue installment scan (single-fire via `overdue_notified_at`, sale → `OVERDUE`) + license expiry scan (30/7/1-day thresholds, single-fire via `license_warning_sent_days`) — guarded at DB level by `UNIQUE(job_name, run_key)` on `scheduled_job_runs` (jobs/scheduledNotifications.job.js; migration 20260627195640).

### 4.7 Password reset
```
POST /auth/forgot-password-request (public, limiter 3/15min)
  → baseClient: find user by email; SHA-256(rawToken) stored; raw 32-byte token emailed via Resend;
    all previous valid tokens for user invalidated; anti-enumeration generic response
POST /auth/reset-password (public, limiter 3/15min)
  → hash incoming token → one-time use (used_at), TTL 1h
  → atomic: password update + revoke ALL refresh tokens + burn token
```
(superadmin.controller.js:294-388; auth.controller.js:506-566)

### 4.8 Impersonation (support flow)
```
POST /api/v1/superadmin/showrooms/:id/impersonate  (sensitiveOpsLimiter)
  → find active showroom, find active OWNER
  → generateImpersonationToken({userId: ownerId, showroomId, role:'OWNER', impersonatedBy: saId}) — 30m, access-only, NO refresh token
  → downstream behaves as that OWNER; original SuperAdmin session preserved client-side for exit
```
(superadmin.controller.js:590-668; config/jwt.js:60-64; frontend lib/auth.ts `startImpersonation/exitImpersonation`)

## 5. Where Business Logic Lives (FACT)

| Concern | Location |
|---|---|
| Sale math, stock deduction, cancellation rules | `services/sales.service.js` (services layer) |
| Installment/notification triggers | `services/notification.service.js` + cron job |
| Supplier balance rules | `services/supplier.service.js` |
| Inventory rules (SOLD immutability, reservation release, low-stock) | `services/inventory.service.js` |
| Search | `services/search.service.js` |
| Analytics aggregation | `services/analytics.service.js`, `superadmin.analytics.service.js` |
| Auth/session rules | `controllers/auth.controller.js` (controller layer, baseClient) |
| Showroom/subscription creation | `controllers/showroom.controller.js` (baseClient, manually scoped) |
| Expense CRUD | **inline Prisma in `controllers/expense.controller.js`** — no service layer (minor asymmetry) |
| License status logic | `controllers/license.controller.js` |
| Invoice presentation | `controllers/invoice.controller.js` (HTML generation) |
| Frontend business rules | Sale form math, installments UI, validation mirrors — mostly duplicate of backend; see Frontend/Backend Audit |

Architectural observation: the service layer is generally consistent; the only controller with inline DB logic is `expense.controller.js`. Duplicated validation is deliberate and layered (zod + controller-level re-checks), which is acceptable.

## 6. Dependency / Coupling Observations (FACT)

- No circular `require` chains detected; service files depend on config/database, utils, notification.service; controllers depend on services and middleware.
- `notification.service.js` is the common side-effect hub (sale, inventory, cron all call it) — coupling by design, fire-and-forget.
- Frontend: single `lib/api.ts` (1045 lines) is the entire API client surface for all domains — large but consistent.
- Root `/` page duplicates `dashboard/settings` with a stub save handler (dead duplicate — see Feature Inventory).

## 7. Deployment Architecture Notes

- `backend/vercel.json`: single serverless function, `includeFiles: ["src/**", "prisma/**"]`, catch-all route, cron at 08:00 UTC daily.
- `backend/src/config/database.js` pins `binaryTargets: ["native", "rhel-openssl-1.0.x", "rhel-openssl-3.0.x"]` (schema.prisma:11) for Vercel.
- In-process `node-cron` is skipped when `process.env.VERCEL` is set; the Vercel cron trigger is the mechanism of record (cron.routes.js comment block).
- **In-memory analytics cache is per-function-instance** — with Vercel's multi-instance model each instance caches separately (RISK: inconsistent values across instances for up to 60s; cache correctness is per-request-held anyway, so impact is minor but cache-hit ratio benefits are reduced).
- Express `app.set('trust proxy', 1)` (index.js:61) — one proxy hop; correct for Vercel's architecture (rate limiting reads header-derived IP).
- No cold-start analysis documented; no warm-up strategy. UNKNOWN: measured cold-start behavior on Vercel.

## 8. Architecture Strengths (confirmed by evidence)

1. Fail-closed tenant isolation in three independent layers — genuinely strong for a SaaS of this size.
2. Single write path for license renewal (`subscription.service.renewSubscription`) with `license_warning_sent_days` reset — avoids the classic stale-guard bug.
3. DB-enforced cron deduplication — no infra dependency.
4. Atomic refresh-token rotation and one-time password-reset tokens.
5. Identity (role/showroom) always resolved from DB, never from JWT claims alone.
6. Audit trail on all sensitive mutations.

## 9. Architecture Limitations (for Lead Architect consideration)

1. **No true platform-level delegated administration** — everything converges on one SUPER_ADMIN account (see Authorization Audit §Roles).
2. **Serverless + Prisma**: per-request connection overhead mitigated by Neon pooling (INFERENCE); no explicit pooling config in repo (UNKNOWN).
3. **No queue/bus** — all side effects are inline fire-and-forget; a crashed process between commit and notification loses notifications (LOW).
4. **No multi-language layer** — Arabic hardcoded across stack (strategy decision needed for future i18n).
5. **No event sourcing/reconciliation for money math** — totals (supplier total_due/total_paid) are maintained incrementally in-transaction; no ledger copy (acceptable at current scale).
6. **Frontend auth cookie (`ys-auth`) is client-writable** — used only for redirect UX; the backend enforces everything. Tampering with the cookie cannot grant access (FACT — middleware.ts reads it; API 401s enforce real auth). Documented as INFORMATIONAL, not a vulnerability.