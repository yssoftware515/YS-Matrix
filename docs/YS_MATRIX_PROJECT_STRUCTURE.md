# YS-Matrix — Repository Structure & Responsibility Map

**Status:** Discovery / Forensic Audit — Phase 1. FACT-based; no files modified.

---

## 1. Root Layout

```
YS-Matrix/
├── backend/     Express/Prisma API ("ys-matrix-erp-backend")
├── frontend/    Next.js 14 SPA ("ys-matrix-erp-frontend")
├── docs/        Existing business/strategy documentation (5 files, audited separately)
└── .git/        Git repo — ZERO commits, all files untracked (FACT)
```

No root README, no root package.json/workspace config, no CI config, no Docker config anywhere in the repo (FACT — glob).

## 2. backend/

### Root files
| Path | Responsibility | Notes |
|---|---|---|
| `package.json` | Scripts: dev (nodemon), start, build (prisma generate), db:migrate, db:seed:admin, db:seed:demo, db:studio, db:reset | No test script, no lint script (FACT) |
| `.env` / `.env.example` | Environment config | **`.env` exists on disk with production-looking values and is gitignored** — safe from git, but note it holds live credentials for the deployed app (see Security Audit) |
| `vercel.json` | Serverless build/route/cron config | Single function; cron 08:00 UTC daily |
| `.gitignore` | node_modules, .env, .env.local, logs, dist, *.log | Adequate |
| `$2`, `curl`, `npx`, `{`, `logs.txt` | **0-byte junk files** — artifacts of mistyped shell redirects (`cmd > $2`, `> curl`, etc.) from 2026-05/06 (FACT — all size 0) | Housekeeping; do not delete during this phase |
| `package-lock.json` / `node_modules` | deps | present |
| `prisma/` | see below | |
| `src/` | application source | |

### backend/prisma/
| Path | Responsibility |
|---|---|
| `schema.prisma` | Full data model: 16 models, 8 enums, indexes, mappings (v1.1/v1.2 comments) |
| `migrations/` | 7 applied migrations + migration_lock.toml (postgres) |
| `stage3_migration.sql` | **Hand-written duplicate of the Stage-3 migration** (adds notifications/subscriptions); differs from applied migration (uses `gen_random_uuid()` defaults, different index name). **Never run it — objects already exist** (RISK/artifact, see Database doc) |

### backend/src/
```
src/
├── index.js                 Server bootstrap: helmet, CORS, rate limiters, route mounts, cron start, error handler, graceful shutdown
├── config/
│   ├── database.js          Scoped Prisma client + GLOBAL_MODELS + fail-closed TenantContextError + baseClient
│   ├── env.validator.js     Boot-time crash on weak/missing secrets; seed-time credential gate
│   ├── jwt.js               Access/refresh/impersonation token sign & verify
│   ├── logger.js            Winston logger
│   └── security.js          Centralized security constants (JWT TTLs, rate limits, CORS, bcrypt, body limit)
├── controllers/             21 files (one per domain + superadmin.analytics.js); thin, delegate to services (expense.controller.js is the exception — inline Prisma)
├── services/                11 files: domain logic (sales, inventory, supplier, customer, analytics, notification, subscription, search, activity, superadmin.analytics, email)
├── routes/                  16 route files (all endpoint inventory in API Audit + Authorization Audit)
├── middleware/              auth, roles, tenant, license, onboarding, audit, validate, cache (8 files)
├── jobs/
│   └── scheduledNotifications.job.js   Daily scan (overdue installments + license expiry), DB run-key lock
├── utils/                   response.js (envelope + codes), pagination.js, invoice.js (advisory-lock invoice numbers), dateRange.js, seed.superadmin.js, seed.demo.js
└── validations/             zod schemas: auth, showroom, sale, search, activity
```

### Responsibility notes per directory
- **config/**: security/tenant isolation constants and enforcement primitives — the "trust anchor" of the backend.
- **controllers/**: HTTP translation + authorization posture already enforced upstream by middleware; a few controllers hold business checks (auth register role rules, onboarding owner-only, invoice HTML generation).
- **services/**: all money/stock/license/notification logic. Tenant-scoped by default; `notification.service.js` and SuperAdmin services deliberately use `baseClient` for cross-tenant paths.
- **jobs/ + cron.routes.js**: scheduled side effects with DB-level deduplication.
- **validations/**: zod; `updateProfileSchema` and `superAdminUpdateUserSchema` use `.strict()`; sale schema uses `superRefine` cross-field rules.

## 3. frontend/

```
frontend/
├── package.json             Next 15.5.23 (Phase 4A upgrade), React 18.3.1, TS 5.4.3; scripts: dev/build/start/lint
├── .env.local               NEXT_PUBLIC_API_URL=https://ys-matrix-backend.vercel.app/api/v1 (gitignored)
├── .env.example             template
├── next.config.js           incl. ignoreBuildErrors: true (repeatedly cited in code comments)
├── vercel.json              Vercel deployment config
├── tailwind.config.js / postcss.config.js / .eslintrc.json / tsconfig.json
├── public/                  manifest.json + webp assets (icons, logo, loading, opengraph)
└── src/
    ├── middleware.ts        Edge route guard from `ys-auth` cookie (redirect-only; real auth is API-side)
    ├── app/                 App Router pages (see §4)
    ├── components/
    │   ├── layout/          DashboardLayout, Navbar, Sidebar (role-aware nav)
    │   ├── sales/           SaleCreateModal, SaleDetailDrawer
    │   └── ui/              DataTable, GlobalSearch (DEAD), KpiCard, Modal, NotificationCenter, SaveModeBar, SplashScreen
    ├── hooks/               useSales, useCustomers, useInventory, useNotifications (60s polling), useSaveMode
    ├── lib/
    │   ├── api.ts           The entire typed API client (1045 lines): axios, interceptors, refresh queue, per-domain API objects
    │   ├── auth.ts          Zustand auth store (persist), token/cookie dual-write, impersonation helpers, isOwnerPlus/isSuperAdmin
    │   └── utils.ts         formatters, roleLabel
    ├── styles/globals.css   Tailwind + cyberpunk theme
    └── types/               sale.types.ts, notification.types.ts (others live in api.ts)
```

## 4. Frontend Page Map (FACT)

| Route | Feature |
|---|---|
| `/` | **Duplicate of `/dashboard/settings`** with a stub `dummySave` (DEAD/duplicate — Feature Inventory flag) |
| `/auth/login`, `/auth/forgot-password`, `/auth/reset-password` | Auth flows |
| `/dashboard` | KPI analytics home |
| `/dashboard/sales` | Sale list/create (modal) + detail drawer |
| `/dashboard/installments` | Installment tracking (overdue/upcoming) |
| `/dashboard/inventory` (+`/inactive`) | Inventory CRUD, bulk, stats, low-stock, soft-delete |
| `/dashboard/customers` (+`/inactive`) | Customer CRUD, soft-delete |
| `/dashboard/suppliers` (+`/inactive`) | Suppliers + payments |
| `/dashboard/expenses` | Expenses CRUD |
| `/dashboard/invoices/[id]` | Invoice view (JSON + print link) |
| `/dashboard/notifications` | In-app notification center |
| `/dashboard/activity` | Audit log viewer |
| `/dashboard/onboarding` | Onboarding wizard (post-login gating) |
| `/dashboard/showrooms` | Showroom list/stats (SuperAdmin) |
| `/dashboard/subscriptions` | Subscriptions/license (SuperAdmin) |
| `/dashboard/settings` | Profile + change password |
| `/dashboard/superadmin/users` | SuperAdmin user management |

## 5. docs/

5 files (audited in `YS_MATRIX_DOCUMENTATION_AUDIT.md`): `architecture-review.md`, `market-positioning.md`, `Matrix.md`, `pricing-analysis.md`, `structure.md`. No READMEs anywhere.

## 6. Structural Findings

1. **No git history** — zero commits; can't attribute changes or review deltas (RISK, HIGH).
2. **Junk 0-byte files** at backend root (`$2`, `curl`, `npx`, `{`, `logs.txt`) — accidental redirect artifacts (LOW).
3. **`.next/` and `tsconfig.tsbuildinfo`** present locally — gitignored (`frontend/.gitignore:2`), fine.
4. **Missing**: tests, CI, lint hooks, README, license file, changelog, docker, monitoring/alerting config, error-tracking (Sentry etc.). All FACT.
5. **`stage3_migration.sql`** is a dangerous leftover (could be mistaken for the applied migration).
6. Single-file API client (`lib/api.ts`, 1045 lines) and hardcoded Arabic throughout — maintainability notes for the tech stack doc.