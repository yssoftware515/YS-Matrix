# YS-Matrix — Discovery Report (Executive Summary)

**Phase:** 1 — Discovery, Forensics, Security Review, Documentation. **No application code modified.**
**Date:** 2026-08-09 · **Evidence:** full static review of `backend/` (Express+Prisma), `frontend/` (Next.js 14), all migrations, seeders, services, configs, and all 5 existing docs.
**Legend:** FACT (verified) · INFERENCE · UNKNOWN · RISK · RECOMMENDATION (not implemented).

---

## 1. Executive Summary

**YS-Matrix is a production-deployed, multi-tenant SaaS ERP for Arabic-market vehicle dealerships ("showrooms")**: inventory, customers, cash + installment sales with item snapshots, supplier payables, expenses, analytics, in-app notifications, license/subscription gating, and a SuperAdmin platform console with tenant impersonation. Backend: Node/Express + Prisma + PostgreSQL on Vercel serverless. Frontend: Next.js 14 SPA on Vercel.

The codebase quality is **above average for its size**: a genuinely layered tenant-isolation design (three defensive layers, fail-closed), real audit trails, hardened auth flows (rotating refresh tokens, hashed one-time password-reset tokens, boot-time secret validation), explicit documentation of each security fix inside the code. The gaps are **operational and strategic, not foundational**: zero tests, zero CI, zero git history (no commits at all), no README, no monitoring, no payments/i18n/upload infrastructure, and — most important for leadership — **no delegated administration model** (single SUPER_ADMIN) and **no product-level support surface**.

## 2. Architecture (see `YS_MATRIX_ARCHITECTURE.md`)

Browser SPA → axios → `/api/v1` (Express) → middleware pipeline (`authenticate → checkLicense → tenantGuard → ensureOnboarded`) → services → Prisma (tenant-scoped, AsyncLocalStorage) → PostgreSQL; Vercel cron at 08:00 UTC → secret-gated `/api/cron/daily-notifications`; Resend only for password-reset email; in-memory 60s cache on 7 analytics endpoints. Money flows (sale create/cancel/pay, supplier payments, license renew) are transactional and fail-closed.

## 3. Technology (see `YS_MATRIX_TECH_STACK.md`)

Express 4 · Prisma 5 @ PostgreSQL · zod · JWT+bcrypt12 · helmet/CORS/rate-limit · winston · node-cron+resend | Next.js 14.2 (App Router) · React 18 · TS 5.4 · Tailwind · TanStack Query 5 · zustand · axios · recharts. Vercel both sides. **No tests, no CI, no Docker, no monitoring, no payments.**

## 4. Domain Model (see `YS_MATRIX_DATABASE.md`)

16 tables, 8 enums. Tenant root `showrooms` → users (SUPER_ADMIN/OWNER/STAFF), inventory (soft-delete, partial index), suppliers+payments (denormalized balances), customers (soft-delete), sales→sale_items (immutable snapshots)→installments, expenses, audit_logs, notifications, subscriptions, refresh_tokens, password_reset_tokens (hashed), scheduled_job_runs (cron lock). 7 clean migrations; one hand-written partial index; seeders are idempotent, demo-blocked in production.

## 5. Authentication (see Authorization Audit)

JWT access 15m + rotating DB-persisted refresh 7d; identity always re-read from DB; license gate on login/refresh; anti-enumeration; rate-limited public reset flows with hashed one-time tokens; change-password revokes all sessions; logout revokes refresh. **No MFA, no email verification.**

## 6. Authorization & Ownership

Roles: SUPER_ADMIN / OWNER / STAFF — enforced **backend-first on every endpoint** (verified per route); frontend hides buttons only. Owner boundaries: three-layer tenant isolation (middleware + Prisma injection + fail-closed exception) with zero confirmed IDOR/BOLA; `baseClient` cross-tenant paths (SuperAdmin console, cron) are explicit and documented. Impersonation (30m access-only token) is the sole supported cross-tenant operational path and is audited.

## 7. Security — Confirmed Findings (see `YS_MATRIX_SECURITY_AUDIT.md`)

| # | Finding | Severity | Rationale |
|---|---|---|---|
| F1 | Invoice print page interpolates DB values unescaped → stored XSS/HMTL injection | **MEDIUM** | Requires authenticated write + print view, but real |
| F2 | Tokens in localStorage; client-writable auth cookie (redirect-only) | MEDIUM | XSS→token theft; cookie itself is inert |
| F11 | No MFA (esp. SuperAdmin gate of impersonation) | MEDIUM | Strategic gap |
| F12 | Customer national_id visible to all staff + invoices | MEDIUM | PII exposure policy gap |
| F19 | `ignoreBuildErrors: true` in next.config | MEDIUM | Disables type gates |
| F3 | Refresh tokens stored raw in DB | LOW | 3-layer mitigation exists |
| F4 | Prod secrets on-disk `.env` | LOW | Gitignored, not committed; rotation unclear |
| F5-F10, F13-F18 | trust-proxy assumption, search limiting, impersonation-by-design, no-CSRF, junk files, demo password fallbacks, no CVE scanning, security headers etc. | LOW/INFO | Documented individually |

**No authentication bypass, no authorization bypass, no IDOR, no mass assignment, no upload vulnerability (no uploads exist), no SQL injection vector found.**

## 8. Frontend/Backend Consistency (see dedicated audit)

Strong parity (routes, role gates, validation, error codes). Confirmed defects: root `/` page is a **stub-save duplicate of Settings (DEAD)**; **GlobalSearch UI unwired** (dead component); `PAYMENT_RECEIVED` notification defined but never fired (doc contradiction); invoice errors in English vs Arabic product.

## 9. Performance (see `YS_MATRIX_PERFORMANCE_AUDIT.md`)

Confirmed: unbounded chart aggregations (JS grouping), unlimited `getEntityHistory`, full-showroom scans in SA license stats, sequential cron loops (serverless timeout risk at scale), LCASE search scans without trigram indexes. Strengths: N+1 fixes already shipped, composite + partial indexes, universal pagination, 60s cache, parallel aggregates. **No issue at current scale.**

## 10. Features (see `YS_MATRIX_FEATURE_INVENTORY.md`)

~34 IMPLEMENTED features verified end-to-end; PARTIAL: global search (backend-only), barcode field (no scanner), PDF (browser print), PWA (no service worker), avatar upload (URL only), email (reset only). NOT IMPLEMENTED (marketing only): payments/SMS/WhatsApp/white-label/i18n.

## 11. Technical Debt

No tests/CI/git history · single 1045-line API client · controller-inline expense logic · `.strict()`-less legacy schemas (few) · dead code (GlobalSearch, page.tsx, notifyPaymentReceived, stage3_migration.sql, root junk files) · `ignoreBuildErrors` · hardcoded Arabic · no README/DEPLOYMENT docs (referenced but missing).

## 12. Scalability

Fine to tens of tenants; growth levers are SQL-side aggregation, pg_trgm search, batched cron, pooling config (UNKNOWN), and multi-instance cache strategy. Delegated administration (multi-admin) and support routing are the next structural additions the platform needs — both currently unimplemented.

## 13. Documentation Quality (see `YS_MATRIX_DOCUMENTATION_AUDIT.md`)

All 5 existing docs are **valuable and mostly accurate**; contradictions: doc "17 models" (actual 16), "empty docs/" (false), "PAYMENT_RECEIVED fired by addPayment" (false), one-time "`.env` committed" CRITICAL (now gitignored — outdated). **No README anywhere.**

## 14. Critical Risks (prioritized)

1. **HIGH — Zero git history / no CI**: the only copy of production code is an untracked working tree; no rollback, no review, no automated checks. First priority for the Lead Architect.
2. **HIGH — No testing**: zero automated tests around money/stock/license logic; a regression in sales math would be silent in production.
3. **MEDIUM — Stored XSS in invoice print (F1)** — small fix, real exposure.
4. **MEDIUM — No MFA for the single SuperAdmin** (identify-gate of impersonation).
5. **MEDIUM — PII (national_id) over-exposure** — needs a product decision.
6. **MEDIUM — Single point of failure in support**: all support = one SuperAdmin + impersonation + external email (personal Gmail per docs).
7. **LOW-MEDIUM — Docs/claims drift** and dead code — cost of continued trust in stale material.

## 15. Recommended Improvements (RECOMMENDATIONS ONLY — not implemented)

1. **Version control**: initial commit + trunk-based workflow + CI (lint, type-check, `prisma migrate deploy` check, `npm audit`).
2. **Tests first** for: sales create/cancel/pay, supplier payments, license renew, tenant isolation, auth flows.
3. **F1 fix** (escape invoice HTML) — smallest highest-value security fix.
4. **Strict builds** (remove `ignoreBuildErrors`) once CI exists.
5. **Delegated admin model**: extend `roles.middleware` + add permission claims only after Lead Architect ratification (see Authorization Audit §6-7); the code is prepared (fail-closed isolation will protect new roles).
6. **Support architecture**: define product-tagged support flow (email identity per product; impersonation as the remote tool) once vision confirmed.
7. **OpenAPI generation** + generated FE types to end type drift.
8. **Ops**: document deploy/runbook, pooling, secrets rotation; clean junk files + `stage3_migration.sql` (archive before removal).
9. **Performance roadmap** (SQL grouping, trigram indexes, batched cron) timed to scale milestones.

## 16. Open Questions (see `YS_MATRIX_OPEN_QUESTIONS.md`)

Delegated admin model specifics · MFA policy · STAFF price/payment permissions · PII policy · production DB/pooling/pipeline reality · Vercel cron-operation confirmation · Resend domain · support mailbox strategy · target scale · invoicing compliance.

---

## Conclusion

YS-Matrix is **real, coherent, and deliberately hardened** — a credible commercial base. The next architecturally significant work is not to rebuild it, but to (1) put it under version control and CI/tests, (2) ratify the delegated-administration and support-service models the business wants, and (3) execute the small, high-value fixes (invoice XSS, strict builds, MFA, PII policy). All findings in the 15 companion documents are evidence-tagged so decisions can be made safely.

**Phase 1 complete — waiting for the Lead Architect's review and instructions. No implementation performed.**