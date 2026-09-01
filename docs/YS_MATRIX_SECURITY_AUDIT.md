# YS-Matrix — Security Audit

**Status:** Discovery / Forensic Audit — Phase 1. Defensive review only; no exploitation performed; no code modified.
**Severity legend:** CRITICAL / HIGH / MEDIUM / LOW / INFORMATIONAL (rationale given per finding).

---

## 0. Method

Static review of every middleware, controller, route, config file, migration, and both `.env`-adjacent files; greps for secrets/sinks; verification of layering claims against code. No dependency exploit database was consulted beyond lockfile inspection (UNKNOWN: live CVE posture — no automated scanner configured).

---

## 1. Confirmed Strengths (FACT, to preserve)

1. **Fail-closed tenant isolation** — three independent layers; `TenantContextError` prevents silent cross-tenant leaks (config/database.js).
2. **Identity always re-read from DB** — JWT claims (role/showroom) are never trusted after decode (auth.middleware.js:59-104).
3. **Boot-time env validation** — weak/missing JWT secrets crash the process (env.validator.js).
4. **Anti-enumeration** on login and forgot-password (uniform messages).
5. **One-time, hashed, TTL'd password-reset tokens**, atomic with session revocation.
6. **Rotating refresh tokens** with atomic rotation; rejected on showroom/license changes (Matrix Audit P2).
7. **Rate limiting** at global/auth/sensitive/superadmin/forgot layers; argon-free but adequate bcrypt 12.
8. **helmet** (CSP in prod, HSTS preload, nosniff, frameguard deny, XSS filter legacy), strict **CORS allow-list with credentials**, production CORS localhost rejection.
9. **Soft-delete everywhere**; no real DELETE SQL paths in application code.
10. **Cross-tenant playbook**: the legacy `?showroom_id=` backdoor for SuperAdmin was removed (tenant.middleware header doc), and all cross-tenant paths are explicit `baseClient` + documented.
11. **Error messages fail closed** outside exact `development`.
12. **Audit trail** on all sensitive mutations (LOGIN, CREATE_USER, CHANGE_PASSWORD, SUPERADMIN_*, IMPERSONATE, RENEW_LICENSE…).

## 2. Findings

### F1 — HTML invoice reflects unescaped DB values (stored XSS / HTML injection)
- **Severity: MEDIUM** (requires an authenticated user with write access to plant payloads — e.g. customer name, notes, product brand/model — then viewed in print view; classic stored XSS, not remote-unauthenticated).
- Evidence: `backend/src/controllers/invoice.controller.js` interpolates `${item.inventory?.brand}`, `${sale.customer?.name}`, `${sale.notes}`, `${sale.showroom.name}`, phone/address, etc. into HTML with no escaping (lines 77-88, 178-181, 199-213, 240). `<script>` in a customer name would execute when the invoice HTML is opened.
- Note: JSON invoice endpoint (`getInvoice`) is safe (JSON serialization).
- RECOMMENDATION: escape all interpolated values (dedicated `esc()` helper) and add `Content-Security-Policy` for the print page; prefer starting from a whitelist of sanitized fields.

### F2 — Access tokens in localStorage + auth cookie is client-set
- **Severity: MEDIUM** (accepted web tradeoff, but explicitly chosen: no httpOnly cookie for the API token; 401-interceptor happy path requires JS-readable storage).
- Evidence: `frontend/src/lib/api.ts` stores `ys_access_token`/`ys_refresh_token` in localStorage; any XSS anywhere in the SPA can exfiltrate both tokens. `ys-auth` cookie (`lib/auth.ts`) is readable by JS and is used only for route-redirect UX — tampering has no server effect (INFORMATIONAL part).
- RECOMMENDATION: when an XSS-hardening pass happens (see F1), consider httpOnly cookie + CSRF strategy, or at minimum a CSP that blocks inline scripts (the invoice print page and next.config currently tolerate inline).

### F3 — Refresh tokens stored raw (JWT string) in DB
- **Severity: LOW** (mitigations: 7d TTL, rotation on use, deletion on logout/showroom-change, unique column).
- Evidence: `auth.controller.js:88-94` stores `token: refreshToken`; `schema.prisma` `RefreshToken.token String @unique`.
- RECOMMENDATION: store SHA-256(token) like password-reset tokens (schema pattern already exists). Low urgency.

### F4 — `.env` files on disk hold production credentials
- **Severity: LOW** (mitigated: both `.env`/`.env.local` are gitignored and repo has no commits).
- Evidence: `backend/.env` (DATABASE_URL len 150, JWT secrets 128 chars, CRON_SECRET 64, RESEND_API_KEY 36, production NODE_ENV, SUPER_ADMIN_EMAIL=`yehiahwary0@gmail.com`); `frontend/.env.local` (NEXT_PUBLIC_API_URL).
- Findings: values look strong (lengths); all gitignored correctly; the machine is the company-controlled dev box presumably. Residuals: (a) production SuperAdmin password sits in a local file — rotate regularly; (b) the personal Gmail as SUPER_ADMIN_EMAIL embeds personal identity into the platform seed; (c) no secret-rotation procedure documented (UNKNOWN).
- RECOMMENDATION: move production secrets to Vercel env store (presumably already done — UNKNOWN); document rotation; never commit.

### F5 — Global rate limit is per-IP with trust proxy=1
- **Severity: LOW/INFORMATIONAL** (Vercel is a single trusted proxy hop; header derived IP is Vercel's real client IP. Without other proxies in front, spoofing requires X-Forwarded-For control which trust-proxy-1 prevents).
- Evidence: `index.js:61` `app.set('trust proxy', 1)`; rate limiters key on `req.ip`. If the deployment ever adds another proxy layer, the count could be bypassed — document assumption.

### F6 — No rate limiting on search + analytics list per se (only global 100/15m)
- **Severity: INFORMATIONAL** (search is LIKE-based, min 2 chars — heavy query cost; global limiter caps abuse but per-user cost is fine at this scale).
- Evidence: search.routes/jobs — no dedicated limiter; `search.service.js` LIKE '%…%'.
- RECOMMENDATION: when multi-tenant scale grows, add per-tenant search limiter + trigram index (see Performance).

### F7 — Impersonation gives full tenant power — by design
- **Severity: INFORMATIONAL** (audited tradeoff — 30m, owner-only targets, sensitive rate limit, audit log).
- Evidence: `superadmin.controller.js:590-668`. Nothing to fix; document as operational risk: a compromised SUPER_ADMIN session can impersonate any tenant within 30 minutes per token, repeatedly (up to 10/15min).

### F8 — No CSRF protection for state-changing endpoints
- **Severity: INFORMATIONAL** (Bearer-token API; browser CSRF can't attach Authorization header from another origin; CORS allow-list blocks reads of responses; same-origin cookies are not used for API auth — the auth cookie is inert for the API).
- Evidence: index.js CORS allow-list + credentials only on allowed origins; API requires `Authorization: Bearer`.
- Note for future: if httpOnly cookie auth is adopted (F2), CSRF tokens/`SameSite` become mandatory.

### F9 — Junk files + stage3_migration.sql artifacts
- **Severity: LOW** (mischief/theft vector if someone runs the raw SQL thinking it's an upgrade; junk files pollute the tree).
- Evidence: `backend/$2|curl|npx|{` (0 bytes), `backend/logs.txt` (0 bytes), `backend/prisma/stage3_migration.sql` duplicates applied migration with different DDL (gen_random_uuid etc.).
- RECOMMENDATION: archive/remove `stage3_migration.sql` after confirming applied state (do not delete during this phase).

### F10 — Demo seed hardcodes fallback passwords
- **Severity: LOW** (guarded: refuses NODE_ENV=production; upsert never overwrites existing rows).
- Evidence: `backend/src/utils/seed.demo.js` (`Demo@Owner2024!`, `Demo@Staff2024!`).
- RECOMMENDATION: keep the guard; consider requiring explicit env passwords like the superadmin seed.

### F11 — No MFA, no email verification, no login anomaly detection
- **Severity: MEDIUM** (product-level gap for a commercial SaaS handling national IDs and financial data).
- Evidence: no 2FA/verification code paths anywhere (grep).
- RECOMMENDATION: business decision; MFA for SuperAdmin at minimum (highest-value account — gate of impersonation).

### F12 — National IDs (customers) are stored and exposed to all tenant staff, and to invoice HTML
- **Severity: MEDIUM** (PII; `customers.national_id` visible to every STAFF in the showroom and printed on invoice HTML — invoices are typically shown to the customer, who owns the ID, but staff beyond need-to-know see it, and invoice JSON endpoint exposes it).
- Evidence: schema `national_id`; invoice.controller.js:201 prints it; customer service returns full customer objects.
- RECOMMENDATION: product decision on who sees national_id (masking in lists, full only where required).

### F13 — API discloses internal IDs (cuid) and timestamps — accepted
- **Severity: INFORMATIONAL** (cuid IDs are enumerable-in-principle but tenant-isolated; no UUIDv4 secrecy needed given isolation layer).

### F14 — No dependency vulnerability scanning / no npm audit in CI
- **Severity: LOW** (no CI to run one; lockfiles present).
- Evidence: no .github workflows, no audit scripts.

### F15 — Error messages in production generic — good; but 500 paths leak in `development` only
- **Severity: INFORMATIONAL/FACT** — verified fail-closed behavior (index.js:176-179). If a staging box has NODE_ENV=development env value… validator otherwise handles production check. Fine.

### F16 — Health endpoint + cron route exposed without rate limit
- **Severity: INFORMATIONAL** (health discloses env name/version — trivial; cron is secret-gated, fails loud when unset).

### F17 — Audit logs contain request metadata (IP, UA) and are insurer of accountability
- **Severity: INFORMATIONAL** — `auditLog` includes IP/UA; IP stored as received (no masking); fine today.

### F18 — Password policy is length-only (8+) with bcrypt(12)
- **Severity: LOW/INFORMATIONAL** (no complexity/compromised-password checks; acceptable baseline; consider adding breach-list check in future).

### F19 — Frontend `next.config.js: ignoreBuildErrors: true`
- **Severity: MEDIUM** (defeats TypeScript/ESLint gates; bug classes (e.g., type mismatches on API shapes) pass builds silently; nothing prevents a security-affecting type error from shipping).
- Evidence: next.config.js + repeated code comments citing it as the reason drift accumulated.
- RECOMMENDATION: switch to strict builds in CI when the repo enters CI (and restore type-check benefits).

---

## 3. Authorization & Tenant Layer Security Summary

- No confirmed authentication or authorization bypass found in the reviewed paths (FACT — every route has explicit middleware chain; register/onboarding have in-controller role checks; impersonation constrained; no mass-assignment risk: all updates destructure explicit fields, several `.strict()` schemas, Prisma-injected `showroom_id` overrides any client-supplied value — database.js:173-196).
- Mass-assignment elimination is real: `updateProfile` whitelists name/avatar_url; `updateUser` whitelists name/role/is_active; create paths destructure (FACT).
- Path traversal / file upload: **no upload code exists** (no multer, no fs writes).

## 4. Data Exposure Audit Summary (see §2 F12/F13 and dedicated notes)

- No password hash appears in any API select (verified: all user selects are explicit field lists; e.g. superadmin.controller.js:82-98, 126-148; auth.controller.js:42-77).
- No tokens returned except token issuance endpoints.
- Internal configuration never returned (raw Prisma errors suppressed outside development).
- Frontend stores user object incl. showroom license_expiry — needed by UI (fine).

## 5. Prioritized Remediation Queue (for planning; nothing implemented)

1. F1 — HTML escaping in invoice print (MEDIUM, quick, low regression risk)
2. F11 — MFA for SUPER_ADMIN (MEDIUM, high value)
3. F12 — national_id visibility policy (MEDIUM, product decision)
4. F2/F19 — XSS-hardening + strict builds (MEDIUM, longer)
5. F3, F4, F10 — hardening items (LOW)
6. UNKNOWN — live CVE posture: run `npm audit` in both trees (no changes permitted this phase).