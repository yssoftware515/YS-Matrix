# YS-Matrix — Authentication, Authorization, Roles & Ownership Audit

**Status:** Discovery / Forensic Audit — Phase 1. Every claim traced to source files (FACT), inference marked, gaps stated.

---

## 1. Authentication Architecture

### 1.1 Login & session model (FACT)
- `POST /api/v1/auth/login` (`backend/src/controllers/auth.controller.js:27`)
  - Cross-tenant email lookup via `baseClient` (email unique platform-wide)
  - Identical error for "user not found" vs "wrong password" → anti-enumeration
  - Distinct error when account disabled (`ACCOUNT_DISABLED`)
  - License: non-SuperAdmin blocked if showroom inactive or `license_expiry` passed
  - Issues **two JWTs** from `{userId, showroomId, role}`:
    - Access token: 15 min, `Authorization: Bearer`
    - Refresh token: 7 days, **persisted raw** in `refresh_tokens` (unique), one-time-use rotation
  - audit-log entry `LOGIN` with IP + user-agent
- **Session renewal**: `POST /auth/refresh` — verifies refresh JWT, checks DB row exists + not expired, **re-validates showroom active + license** (Matrix Audit P2 fix; deletes token on rejection), rotates atomically in `$transaction` (F-15 fix)
- **Logout**: `POST /auth/logout` deletes the refresh token only — the access token remains valid until its 15-min expiry (standard JWT behavior; INFORMATIONAL)
- **Change password**: `PUT /auth/change-password` — verifies current, length 8–128, rejects same-as-current, **revokes ALL refresh tokens** (forces re-login everywhere)
- **Password reset (self-service)**: public `forgot-password-request` (rate-limited 3/15min, anti-enumeration, invalidates all prior tokens) + `reset-password` (SHA-256-hashed token lookup, one-time `used_at`, 1h TTL, atomic update + revoke-all + burn) — `auth.controller.js:506`, `superadmin.controller.js:294`
- **No 2FA/MFA, no email verification, no remember-me toggle** (refresh cookie-less; FE decides persistence — 7d refresh is effectively "remember me") — FACT

### 1.2 Token details (FACT)
- Secrets: `JWT_ACCESS_SECRET` / `JWT_REFRESH_SECRET`, verified at boot to be strong/unique (env.validator.js); on-disk `.env` has 128-char secrets (LEN:128 observed)
- Access claims: `{userId, showroomId, role}` — but **identity is always re-resolved from DB** in `auth.middleware.js:59` (role/disable/showroom changes take effect immediately; stale claims never trusted) — strong design
- Impersonation tokens: 30-min access-only, `impersonatedBy` claim, no refresh (see §5)

### 1.3 Frontend side (FACT)
- Tokens stored in **localStorage** (`ys_access_token`/`ys_refresh_token`) + auth state cookie `ys-auth` (client-writable, used only for Edge redirects)
- 401 interceptor with **singleton refresh queue** (`frontend/src/lib/api.ts`) — concurrent 401s share one refresh; second failure → clear + redirect to login
- Access token in localStorage is XSS-exposed by design (no httpOnly cookie option) — RISK/MEDIUM (see Security Audit)

## 2. Role Model (the entire current role set — FACT)

Enum: `SUPER_ADMIN` (3), `OWNER` (2), `STAFF` (1) — `roles.middleware.js:15-19`; stored per-user in `users.role` (`schema.prisma` UserRole).

### 2.1 SUPER_ADMIN
- **Only** platform operator account. Created exclusively by `seed.superadmin.js`; **no API can create/assign SUPER_ADMIN** (`auth.controller.js:149-151` blocks the role; `superadmin.controller.js:184-186` blocks assignment; `superAdminUpdateUserSchema` role enum is only OWNER/STAFF)
- Resides in the synthetic "system showroom" (`system-showroom-001`) — not a real tenant
- Can: all `/superadmin/*` endpoints (system stats, all showrooms, all users, impersonation, password reset of others), showrooms CRUD+stats, license renew, subscription all/in summary/renew; bypasses license & onboarding checks; on regular tenant routes it is **locked to the system showroom** (tenantGuard sees its own showroom_id)
- Cannot: be edited/reset/password-reset by another SUPER_ADMIN (`superadmin.controller.js:179-181, 458-460`) — single-account protection
- Controls: `superAdminLimiter` 30/15m; sensitive ops (impersonate, create user, reset password) additionally 10/15m

### 2.2 OWNER
- Showroom owner/administrator. Created by SUPER_ADMIN (any showroom) or via showroom creation (bundled).
- Can (beyond STAFF): deactivate/reactivate customers, suppliers, inventory; cancel sales; delete expenses; delete old notifications; view activity/audit logs (all `ownerOnly` routes — see §4); create STAFF accounts via `POST /auth/register` (but cannot create an OWNER — only SUPER_ADMIN can, `auth.controller.js:145-147`)
- Onboarding wizard completion requires OWNER or SUPER_ADMIN (`onboarding.controller.js:33-35`)

### 2.3 STAFF
- Can: all CRUD on customers/suppliers/inventory, create sales, pay installments, view invoices, expenses (create/update), analytics, notifications, search, own profile/change password, generate invoice HTML
- Cannot: any ownerOnly action, register users, onboarding, activity logs
- **No per-feature granularity beyond the role split** — e.g., a STAFF user can create sales AND delete customers' records? No — delete is ownerOnly; but STAFF can create customers, sales, edit inventory prices, edit expenses. There is **no can-edit-prices-vs-can-sell split within STAFF** (see §7 recommendations)

### 2.4 Enforcement: backend-first, frontend mirrors (FACT)
- Backend: role checks via middleware (`requireRole`/`requireMinRole`/`ownerOnly`/`superAdminOnly`) on every row of every route table; plus in-controller checks (register, onboarding, impersonation-assignment)
- Frontend: `middleware.ts` gates `/dashboard/superadmin/*` by role (client cookie — cosmetic); `Sidebar` shows/hides nav items (`isSuperAdmin(user?.role)`, Sidebar.tsx:104); pages gate destructive buttons (`isOwnerPlus` — e.g., customers/page.tsx:65 "matches backend's ownerOnly")
- **Conclusion: authorization is enforced in the backend for every endpoint. Frontend gates are UX only. No endpoint relies on frontend hiding.** — verified per-route in the API audit

## 3. Ownership / Tenant Boundaries (multi-tenant model)

### 3.1 Hierarchy actually implemented (FACT)
```
SUPER_ADMIN (platform; system showroom)
   └── Showroom (tenant) ── OWNER(s)* ── STAFF
        ├── inventory / suppliers / customers / sales / expenses / notifications / audit logs
        └── Subscription / license (per showroom)
```
(*) Multiple OWNERs per showroom are possible (SUPER_ADMIN can create more), but the product convention is one owner per showroom.

**There is no Client/Store chain beyond one level** — the current ownership model is exactly: Platform → Showroom → Users. No plans implemented for Admins/Clients (see §7).

### 3.2 Isolation mechanics (FACT, three layers)
1. `tenantGuard` — showroom_id resolved only from authenticated user's DB row; mismatched client supply → 403 `CROSS_TENANT_BLOCKED` (every role)
2. Prisma extension — injects `showroom_id` into all scoped reads/writes; `GLOBAL_MODELS` allow-list exempts Showroom, RefreshToken, AuditLog, Installment, SaleItem, SupplierPayment, ScheduledJobRun
3. Fail-closed `TenantContextError` when scoped op runs without context

### 3.3 Resource-level ownership checks (verified per controller — FACT)
- Every `:id` update/delete on customers, suppliers, inventory, sales, expenses, notifications uses `findFirst({ id, showroom_id: req.showroomId })` before mutation (explicit or injected)
- Installment payment checks `installment.sale.showroom_id !== showroomId → FORBIDDEN` (sales.service.js:476-478)
- Invoices scope by `{ id, showroom_id }` (invoice.controller.js:16-17, 50-51)
- Activity log queries scoped by showroom and gate entity type by allow-list (`activity.validation.js ENTITY_TYPES`)
- SuperAdmin cross-tenant reads (showrooms, users, subscriptions, system stats, licenses) run on `baseClient` with manual filters and rate limits; **no direct record-level reads of another tenant's domain rows exist outside impersonation** (FACT — the removed `?showroom_id=` backdoor is gone; see tenant.middleware.js header)
- `users` are NOT directly selectable by tenant ID except via superadmin endpoints (user removed from GLOBAL_MODELS)

### 3.4 IDOR/BOLA verification (defensive, no exploitation)
- Attempted pattern: any normal route carrying `?showroom_id=` or body `showroom_id` differing from the user's own → blocked at `tenantGuard` (FACT code path)
- Crafted `:id` belonging to another showroom → Prisma findFirst with both id+showroom_id returns null → 404 (no cross-tenant read; can't distinguish existence — acceptable)
- Invoice number enumeration: format `INV-XXX-YYYY-NNNNN` is guessable, but the invoice endpoints require auth + same-showroom ownership (FACT) → no exposure
- Refresh token replay: rotation + unique constraint + transaction → replay produces error, no mint (FACT)
- **Conclusion: no confirmed IDOR/BOLA in the current code.** The main residual risks are (a) `baseClient` manual-filter discipline in SuperAdmin surfaces, (b) any future endpoint that forgets `showroom_id` will throw `TenantContextError` (fail-safe), (c) `users` cross-tenant lookup by email is exposed via login flow intentionally (email enumeration mitigated by uniform responses)

## 4. Route-by-Route Authorization Matrix (FACT — from route files)

Legend: A=authenticate, L=checkLicense, T=tenantGuard, O=ensureOnboarded, R=role guard, V=validate, Q=query-validate, Lim=rate limiter.

| Module | Pipeline | role-gated routes |
|---|---|---|
| auth | public: login, refresh, forgot-password-request, reset-password / authed: me GET+PATCH, logout, register, change-password | **register**: OWNER|SUPER_ADMIN only (controller check; OWNER can create STAFF only) |
| customers | A L T O | DELETE + reactivate: **ownerOnly** |
| sales | A L T O | cancel: **ownerOnly** |
| inventory | A L T O | DELETE + reactivate: **ownerOnly** |
| suppliers | A L T O | DELETE + reactivate: **ownerOnly**; payments: any staff (history+add) |
| expenses (under /analytics) | A L T O | DELETE: **ownerOnly** |
| invoices | A L T | public within tenant (both read + HTML) |
| notifications | A L T | DELETE /old: **ownerOnly**; read ops: any |
| activity | A L T | **ALL ownerOnly** |
| search | A L T O | any authenticated |
| analytics | A L T O | any authenticated (cache on 7 GETs) |
| onboarding | A L T | PATCH: OWNER|SUPER_ADMIN (controller) |
| showrooms | A T -> superAdminOnly | ALL |
| licenses | A T | renew + all: **superAdminOnly**; status: any |
| subscriptions | A T | current/history: any (checkLicense per-route); all/summary/renew: **superAdminOnly** |
| superadmin | superAdminLimiter → A → (T skip for SA) → **superAdminOnly** | ALL; sensitiveOpsLimiter on impersonate/create-user/reset-password |
| cron | none (public) | bearer CRON_SECRET only |

**Staff write capabilities to note (FACT):** STAFF can create/edit inventory items **including prices**, create/edit customers, create sales, create expenses, add supplier payments, record installment payments. Owner restrictions are limited to delete/reactivate/cancel/activity/register. This is a deliberate design but worth an explicit product decision (pricing control typically owner-only in competing ERPs).

## 5. Impersonation — the cross-tenant support mechanism (FACT)

- `POST /api/v1/superadmin/showrooms/:id/impersonate` (sensitiveOpsLimiter 10/15m)
- Constraints: target showroom must be active; picks an active OWNER; **rejects impersonating SUPER_ADMIN** (only showrooms)
- Issues a 30-min access-only token with `{userId: targetOwnerId, showroomId, role: OWNER, impersonatedBy: saId}` — the downstream stack treats it as exactly that OWNER (no special-casing), so all tenant rules apply
- No refresh token → session cannot extend; when expired, FE redirects to login
- Full audit trail: `IMPERSONATE_SHOWROOM` entry + `req.impersonatedBy` available on all downstream requests (auth.middleware.js:102)
- Frontend: `startImpersonation` stashes original session; `exitImpersonation` restores (lib/auth.ts)
- Assessment: well-designed; the token embeds target identity, not the admin's, eliminating accidental privilege that cookies/flags would create (RISK mitigated; residual: impersonation of an OWNER gives full tenant power, including cancel sales — intended)

## 6. Future Administration Model — Gap Analysis (NO IMPLEMENTATION)

Requested future direction: Super Admin / Admin Leader / Admin / Client-Owner / Employees + scoped permissions + audit trails + privilege-escalation prevention.

Current state vs. that target:

| Future concept | Current support | Gap |
|---|---|---|
| Platform Super Admin | ✅ exists (single account) | No multi-admin; no sub-admin (Admin Leader/Admin) concepts in code |
| Delegated administrators | ❌ | Only SUPER_ADMIN can create users; no admin-of-admins hierarchy |
| Admin creating clients | ✅ partial | "Client" == Showroom; SUPER_ADMIN creates showrooms+owner in one shot — fine as a base |
| Admin creating employees | ✅ | SUPER_ADMIN creates OWNER/STAFF for any showroom; OWNER creates STAFF within own showroom |
| Scoped permissions / RBAC beyond role | ❌ | Two hardcoded role gates (`ownerOnly`, `superAdminOnly`) + hierarchy; no permission table/claims |
| Tenant scoping at platform level | ✅ | Showroom-scoped isolation is mature (3 layers) |
| Administrative audit trails | ✅ strong | audit_logs + activity endpoints + superadmin-specific actions recorded with target showroom |
| Privilege escalation prevention | ✅ strong | SUPER_ADMIN unassignable, single-SA guard, role always re-read from DB, register blocked for SUPER_ADMIN role, impersonation constrained to OWNER of active showroom |

**Key architectural facts for the Lead Architect's decision:**
1. Roles are a DB enum + numeric hierarchy in one middleware file — easy to extend to 4-5 roles (INFORMATIONAL)
2. There is **no permission/claim system** — any finer-grained model needs either an RBAC table or policy layer; middleware path is centralized (single file to modify)
3. All authorization records live ONLY as `user.role`; policies are not data-driven
4. SuperAdmin paths bypass tenant scope by client choice (`baseClient`) — a delegated-admin model must decide how platform staff (non-SuperAdmin) will be tenanted (e.g., an operational tenant vs query-level scoping)
5. The fail-closed tenant layer means adding a new role CANNOT accidentally create a cross-tenant path in scoped code — new roles inherit isolation automatically (INFERENCE from design, but consistent with code)
6. Audit trails already record actor + target showroom + IP + UA — sufficient foundation for delegated-admin accountability
7. Business-name mapping: the current OWNER already plays "Client/Showroom Owner"; STAFF ≡ "Employees"; SUPER_ADMIN ≡ "Super Admin". The missing middle layer ("Admin Leader"/"Admin") is entirely new surface

## 7. Authorization Findings & Recommendations (no implementation)

1. **INFORMATIONAL**: `ys-auth` cookie is client-writable and ignored by the API — do not confuse its role gating with security.
2. **MEDIUM, RECOMMENDATION**: consider owner-only gates for price editing (selling_price/cost_price on inventory update, expense amounts) if the business wants tiering — currently any STAFF can alter pricing and record payments, which affects "trust at POS".
3. **MEDIUM, RECOMMENDATION**: password-reset-audit endpoint `GET /superadmin/password-reset-requests` relies on audit-log rows (7-day window, PAGED) — is not itself sensitiveOps-limited; consider the same limiter (INFO level today).
4. **LOW, RECOMMENDATION**: multiple OWNERs per showroom are possible but the UI assumes one; document the intended convention.
5. **LOW**: refresh-token raw storage (three-layer mitigation in place; hashing optional hardening).
6. **INFORMATIONAL**: `PATCH /superadmin/users/:id` is not covered by `sensitiveOpsLimiter` (only impersonate/create-user/reset-password are) — role changes by SuperAdmin are exactly the escalation-prone op; consider adding the limiter when the admin model expands (documented today, low urgency since single account).
7. **Ask for Lead Architect**: should future support team (YS-Care etc.) surface use impersonation, or a read-only audit role? Impersonation is the only tenant-access path today and it's SuperAdmin-only by design.