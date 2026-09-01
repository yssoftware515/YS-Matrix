# YS-Matrix — System Overview

**Status:** Discovery / Forensic Audit — Phase 1. No application code modified.
**Evidence basis:** Direct source-code, migration, configuration, and documentation inspection of the repository at `G:\YS_System\YS\YS-Matrix`, as of 2026-08-09.
**Classification legend:** FACT = verified from code/config; INFERENCE = strongly suggested; UNKNOWN = not determinable; RISK = confirmed or demonstrated risk; RECOMMENDATION = proposed improvement (not implemented).

---

## 1. What YS-Matrix Is

YS-Matrix is a **multi-tenant SaaS ERP for vehicle dealerships ("showrooms")** in the Arabic-speaking market (FACT).

- Backend: Node.js + Express + Prisma + PostgreSQL (FACT — `backend/package.json`, `backend/prisma/schema.prisma`)
- Frontend: Next.js 15 App Router (Phase 4A upgrade from 14.2.35) + React 18 + TypeScript (FACT — `frontend/package.json`)
- Branding in code: "YS-MATRIX ERP", "YS Systems & Software" (FACT — `backend/src/index.js:187`, invoice footer `backend/src/controllers/invoice.controller.js:244`)
- The application is Arabic-first (RTL); all user-facing messages are hardcoded Arabic; no i18n framework (FACT — response strings throughout controllers/middleware)

The core domain: a showroom manages **inventory** (vehicles, motorcycles, tuktuks, spare parts), **customers**, **cash and installment sales**, **supplier purchases/payments**, **expenses**, and reads **analytics**. A **license/subscription** system gates tenant access, and a **SuperAdmin** operates a platform control plane (showrooms, users, licenses, subscriptions, impersonation, system stats) (FACT — `backend/prisma/schema.prisma`, route inventory).

## 2. Market/Deployment Position

- The repository was found with **zero git commits** — everything is untracked on branch `master` (FACT — `git status`). A production-like codebase with no version history is a serious operational risk (see Discovery Report).
- Deployed as **two Vercel serverless apps** (FACT — `backend/vercel.json`, `frontend/vercel.json`; on-disk `.env` files reference `https://ys-matrix-backend.vercel.app` and `https://ys-matrix-frontend.vercel.app`).
- Database: PostgreSQL on Neon (INFERENCE — Prisma datasource provider + Vercel deployment; exact hosting not verifiable from repo).
- Docs claim "serving real dealerships" (`docs/Matrix.md:9`) — **UNVERIFIABLE from repository evidence**.
- Support email `cantactys@gmail.com` and platform `http://yssoftware.online` do **not** appear anywhere in application code (FACT — grep of the repo; see `YS_MATRIX_DOCUMENTATION_AUDIT.md` §Support/Contact).

## 3. Product Structure at a Glance

### Platform control plane (SUPER_ADMIN)
- Showroom lifecycle (create showroom + its OWNER + subscription in one transaction)
- License renewal, subscription management
- User management (create OWNER/STAFF anywhere, update, password reset)
- Impersonation (30-minute scoped session swap)
- System-wide analytics
- (FACT — `backend/src/controllers/superadmin.controller.js`, `showroom.controller.js`, `subscription.service.js`)

### Tenant workspace (OWNER / STAFF)
- Onboarding wizard before first use
- Inventory (CRUD, bulk create, low-stock alerts, soft delete)
- Suppliers + payments against outstanding balance
- Customers (soft delete)
- Sales (cash + installment, item snapshots, inventory deduction, cancellation)
- Installments (pay, overdue/upcoming views, auto-OVERDUE status)
- Invoices (JSON + printable HTML)
- Expenses
- Analytics dashboard (KPIs, charts, weekly/monthly comparison)
- Notifications (in-app)
- Activity/audit log viewer (OWNER only)
- Global search (backend implemented; frontend unwired — see Feature Inventory)
- Profile settings / change password
- (FACT — route inventory + page inventory)

## 4. Major Architectural Blocks

| Block | Implementation | Evidence |
|---|---|---|
| API server | Express 4, `/api/v1` prefix, mounted modules | `backend/src/index.js` |
| ORM | Prisma 5.10 with a custom tenant-scoped extension (`$allOperations`) | `backend/src/config/database.js` |
| Tenant isolation | Express middleware + AsyncLocalStorage + fail-closed Prisma extension | `tenant.middleware.js`, `database.js` |
| Auth | JWT access (15m) + DB-persisted rotating refresh (7d) | `config/jwt.js`, `auth.controller.js` |
| Roles | `SUPER_ADMIN` / `OWNER` / `STAFF` enum, role middleware | `roles.middleware.js` |
| Audit trail | `audit_logs` table, fire-and-forget `auditLog()` | `audit.middleware.js` |
| Scheduled jobs | node-cron + Vercel cron HTTP trigger, DB run-key lock | `jobs/scheduledNotifications.job.js`, `routes/cron.routes.js` |
| Email | Resend (password-reset only) | `services/email.service.js` |
| Caching | In-memory 60s TTL, tenant-scoped, 7 analytics GETs only | `middleware/cache.middleware.js` |
| Frontend | Next.js App Router, client-rendered dashboard, react-query + zustand | `frontend/src/app/**`, `lib/api.ts`, `lib/auth.ts` |

## 5. Known Gaps at a Glance (detailed in dedicated reports)

- **No tests anywhere** (FACT — zero test files).
- **No CI/CD configuration** (no GitHub Actions, etc.) (FACT).
- **No README** anywhere (FACT).
- **No Docker/container config** (FACT).
- **No payment integration** (Stripe is proposed in docs only) (FACT).
- **No file upload mechanism** — media fields are external URLs only (FACT — no multer/upload code; `image_urls String[]`).
- **No SMS/WhatsApp** (marketing docs only) (FACT).
- **No support/contact surface** in the product (FACT — grep).
- **In-process caching replaces Redis**; fine for single instance, degrades under multi-instance (see Performance Audit).
- **Single SUPER_ADMIN** acting as both platform operator and support agent — no delegated administration (see Authorization Audit).

## 6. Ownership Model (one-paragraph summary)

`Showroom` is the tenant root. Every domain entity carries `showroom_id`; `User` belongs to exactly one showroom (`users.showroom_id NOT NULL`). `SUPER_ADMIN` sits outside the tenant model (its account is seeded into a synthetic "system showroom") and reaches tenant data only through deliberately unscoped `baseClient` paths and the audited impersonation flow. All tenant-scoped queries are mechanically isolated by the Prisma extension — see `YS_MATRIX_AUTHORIZATION_AUDIT.md` for the three-layer defense.