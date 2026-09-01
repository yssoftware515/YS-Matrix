# YS-Matrix — Technology Stack Audit

**Status:** Discovery / Forensic Audit — Phase 1. All entries verified against manifests AND code usage (FACT unless marked).

---

## 1. Backend

| Layer | Technology | Version | Verified usage (FACT) |
|---|---|---|---|
| Runtime | Node.js | >=18 (engines) | `package.json engines`; scripts run node |
| Framework | Express | ^4.18.3 | `index.js` app/bootstrap |
| Language | JavaScript (CommonJS) | — | all `.js` files `require()` |
| ORM | Prisma Client | ^5.10.0 | `schema.prisma`, `config/database.js` extension |
| Database | PostgreSQL | unversioned provider | `datasource db { provider = "postgresql" }`; migration_lock |
| Validation | zod | ^3.22.4 | `validations/*`, `validate.middleware.js` |
| Auth | jsonwebtoken | ^9.0.2 | access/refresh/impersonation tokens |
| Password hashing | bcryptjs | ^2.4.3 | rounds 12 (default) |
| Rate limiting | express-rate-limit | ^7.2.0 | global/auth/sensitive/forgot-password/superAdmin limiters |
| Security headers | helmet | ^7.1.0 | index.js |
| CORS | cors | ^2.8.5 | allow-list + credentials |
| Logging | winston + morgan | ^3.12.0 / ^1.10.0 | logger.js; morgan dev/combined |
| Cron | node-cron | ^4.5.0 | `scheduledNotifications.job.js` start() |
| Email | resend (SDK) | ^6.16.0 | `email.service.js` — password-reset only |
| Scheduling lock | Postgres unique constraint | — | `ScheduledJobRun` + P2002 arbitration |
| Misc | dotenv, date-fns | ^16.4.5 / ^4.2.1 | env loading, date utilities |
| Dev deps | nodemon, prisma CLI, @types/bcrypt | — | scripts |
| Hosting | Vercel (serverless function) | — | `backend/vercel.json` |

Confirmed absent (FACT): Redis/cache server, queue/bus (Bull/Redis), ORM-level mappers beyond Prisma, i18n, OpenAPI/Swagger, test framework, TypeScript, ESLint, CI.

## 2. Frontend

| Layer | Technology | Version | Verified usage (FACT) |
|---|---|---|---|
| Framework | Next.js (App Router) | 15.5.23 (exact pin — Phase 4A upgrade from 14.2.35) | `src/app/**`, `src/middleware.ts` |
| UI library | React | 18.3.1 | pages/components |
| Language | TypeScript | 5.4.3 | `.tsx/.ts`; `tsconfig.json` |
| Styling | Tailwind CSS | 3.4.3 | globals.css, tailwind.config.js; `next lint` (eslint 8.57 + eslint-config-next 15.5.23, postcss 8.5.26) |
| Server state | @tanstack/react-query | 5.28.4 | providers.tsx (staleTime 60s, retry 1); all hooks |
| Client state | zustand | 4.5.2 | `lib/auth.ts` persist store |
| HTTP | axios | ^1.18.1 | `lib/api.ts` interceptors + refresh queue |
| Toasts | react-hot-toast | 2.4.1 | success/error surfaces |
| Charts | recharts | 2.12.3 | dashboard analytics |
| Motion | framer-motion | 11.0.28 | page/panel animations |
| Icons | lucide-react | 0.368.0 | nav/buttons |
| Class utils | clsx, tailwind-merge | 2.1.0 / 2.2.2 | cx() helper |
| Hosting | Vercel | — | `vercel.json` |

Confirmed absent (FACT): no component library (custom UI primitives), no i18n library (hardcoded Arabic), no PWA service worker, no test framework, no Storybook, no state-machines.

## 3. Cross-Cutting

| Concern | Answer | Evidence |
|---|---|---|
| API architecture | REST under `/api/v1`, JSON envelope `{success, message, data[, pagination|errors], timestamp}` + machine `.code` | utils/response.js |
| Auth mechanism | JWT Bearer (access 15m) + rotating refresh (7d, DB-stored) | config/jwt.js, auth.controller.js |
| Authorization | Role middleware (`SUPER_ADMIN 3 / OWNER 2 / STAFF 1`) + tenant scope injection | roles.middleware.js, database.js |
| Storage | No file storage; media as URLs in DB (`image_urls String[]`, avatar_url, logo_url) | schema.prisma |
| Caching | In-memory Map, 60s TTL, 7 analytics endpoints | cache.middleware.js |
| Queues/jobs | node-cron + Vercel cron + DB lock; no queue system | jobs/, cron.routes.js |
| Notifications | In-app DB rows only; email only for password reset | notification.service.js, email.service.js |
| Search | Prisma `contains/insensitive` (LIKE %..%) across 4 entities, limit 5 each | search.service.js |
| Payments | None (Stripe proposed in docs only) | grep; docs |
| Analytics | Aggregations in SQL (Prisma) + JS-side grouping; superadmin system stats | analytics services |
| Observability | winston logs + audit_logs table; **no metrics/APM/alerting** | config/logger.js |
| Testing | **Zero tests** (no *.test/spec anywhere) | glob |
| CI/CD | **None** | glob (no .github/workflows) |
| Containers | **None** | glob (no Dockerfile) |
| Version control | Git, but **0 commits** | git status |

## 4. API Surface Summary (see API Audit for details)

- 16 route modules, **79 application endpoints** + `GET /health` + `GET /api/cron/daily-notifications`
- Versioned prefix `/api/v1`; cron outside prefix by design
- Rate limiters: global 100/15m; auth 10/15m; forgot/reset 3/15m; superadmin 30/15m; sensitive ops 10/15m

## 5. Dependency Health Notes

- All deps are mainstream and current-ish for 2026 (verified in lockfiles); no obviously abandoned packages.
- `next.config.js` sets `ignoreBuildErrors: true` (FACT) — suppresses TS/build errors; repeatedly cited in code comments as the reason type drift silently accumulates (RISK: type-safety guarantees eroded; RECOMMENDATION: enable error-failing builds once refactor readiness allows).
- Prisma `binaryTargets` includes rhel-openssl variants — used for Vercel (documented in cron.routes.js).
- No `npm audit`/`dependabot` configuration; vulnerability posture UNKNOWN beyond lockfile inspection (no automated scanning).

## 6. Stack Verdict (analysis)

The stack is **coherent, lightweight, and maintainable for the current scale**: Express + Prisma + Vercel + Postgres is a defensible SaaS baseline; Next.js 14 + React Query covers the frontend well. The notable gaps are operational (tests, CI, monitoring, git history) and strategic (payments, i18n, delegated admin), not foundational. Serverless + Prisma on a single region is appropriate today; the multi-instance behaviors (in-memory cache, in-process cron) are controlled via explicit design (DB lock, Vercel cron) — see Performance and Architecture docs.