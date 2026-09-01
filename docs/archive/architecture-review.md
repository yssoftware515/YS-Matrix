# YS-MATRIX ERP — Complete Architecture Review

---

## SCORING SUMMARY

| Category | Score (1-10) | Assessment |
|----------|-------------|------------|
| Code Quality | 7/10 | Clean, consistent patterns but no tests |
| Scalability | 6/10 | Good architecture but single-DB bottleneck |
| Maintainability | 8/10 | Excellent separation of concerns, thin controllers |
| Modularity | 8/10 | Well-separated modules, clear boundaries |
| Separation of Concerns | 9/10 | Middleware → Controller → Service → Prisma is clean |
| Technical Debt | 4/10 (low=good) | Minor issues but overall low debt |
| Future Scalability | 6/10 | Vercel limits, no read replicas, no queue |
| SaaS Readiness | 8/10 | Multi-tenant, license mgmt, subscriptions built-in |
| Multi-Tenancy Readiness | 9/10 | AsyncLocalStorage + Prisma extension is state of the art |
| Enterprise Readiness | 5/10 | Missing SSO, SAML, RBAC groups, audit export |
| Team Onboarding Friendliness | 7/10 | No tests, no docs, but very consistent patterns |

**Overall Score: 7/10** — A well-architected, production-ready small-to-mid SaaS ERP. The architecture is clean and the core patterns are correct. The biggest gaps are in testing, infrastructure, and enterprise features.

---

## 1. CODE QUALITY — 7/10

### Strengths

**Consistent Patterns Throughout:**
- Every controller follows: parse request → call service → respond via response.js
- Every service follows: accept `{ showroomId, ...params }` → business logic → return result
- Every route follows: middleware chain → handler
- Every validation follows: Zod schema → validate middleware → Arabic error messages

**Error Handling:**
- Unified response envelope: `{ success, message, data, pagination?, code?, errors?, timestamp }`
- Machine-readable error codes (e.g., `LICENSE_EXPIRED`, `VALIDATION_ERROR`, `TENANT_CONTEXT_MISSING`)
- Controllers use `handleServiceError()` to map service errors to HTTP codes
- Fail-closed: missing tenant context throws, expired license blocks, missing JWT rejects

**JavaScript (Backend):**
- Modern ES6+ with destructuring, arrow functions, async/await
- No callback patterns, no `var`, no implicit globals
- Consistent error-first patterns with `try/catch`

**TypeScript (Frontend):**
- Strict mode enabled
- Proper typing for all API responses (ApiEnvelope<T>, Paginated<T>)
- Comprehensive type definitions matching Prisma models

### Weaknesses

**No Tests:**
- Zero test files exist anywhere in the project
- No unit tests, integration tests, E2E tests
- Critical business logic (installment calculation, profit, inventory deduction) has no automated verification
- **Risk:** Any refactor or change must be manually tested

**JavaScript Over TypeScript (Backend):**
- Backend uses plain JavaScript (no TypeScript)
- No type safety for Prisma queries, service parameters, controller responses
- Increases risk of runtime type errors

**No ESLint/Prettier Config:**
- Frontend has ESLint (next/core-web-vitals), backend has none
- No Prettier config
- No Husky or lint-staged

**Expense Controller (outdated pattern):**
- `expense.controller.js` still uses inline Prisma queries instead of a service layer
- Inconsistent with the rest of the codebase pattern

### Critical Files to Handle with Care

| File | Risk | Reason |
|------|------|--------|
| sales.service.js | HIGH | Core business logic: installment generation, inventory deduction, profit calculation, cancel flow with atomic guards |
| database.js (config) | HIGH | Multi-tenant isolation engine. A bug here leaks data across showrooms |
| tenant.middleware.js | HIGH | Zero-trust tenant resolution. Breaking this compromises all isolation |
| auth.controller.js | HIGH | Login, JWT generation, token rotation, impersonation |
| notification.service.js | MEDIUM | Cron scans affect all tenants. Failures here mean missed notifications |
| invoice.js (utils) | MEDIUM | Race-condition-free invoice numbering. Breaking it creates duplicate invoice numbers |
| scheduledNotifications.job.js | MEDIUM | Distributed cron coordination. Failure mode is duplicate runs (safe but wasteful) |

---

## 2. SCALABILITY — 6/10

### Current Architecture

```
[Vercel Edge] → [Vercel Serverless Functions] → [Neon PostgreSQL (Single DB)]
```

### Scaling Limits

| Constraint | Current | Limit | Risk |
|-----------|---------|-------|------|
| Database | Single Neon instance | ~100 concurrent connections | Connection exhaustion with 50+ concurrent showrooms |
| Prisma Connection Pool | Default 10 | Configurable up to ~50 | Hit Neon's limit before that |
| Cache | In-memory Map (single process) | Restarted on every cold start | Ineffective with serverless |
| Cron | Vercel Cron (single source) | Once per day max frequency | Can't scale to hourly |
| File Storage | Logo URLs only (no file uploads) | No storage system | Not ready for document management |
| Background Jobs | In-process / Vercel Cron | No queue system | Heavy operations block the request |

### Recommended Scaling Path

1. **Immediate (0-50 showrooms):** Current architecture works fine. Neon can handle this.
2. **Short-term (50-500 showrooms):** 
   - Add PgBouncer for connection pooling
   - Replace in-memory cache with Redis (Upstash)
   - Add read replica for analytics queries
   - Move notifications to a queue (Bull + Redis)
3. **Medium-term (500-5000 showrooms):**
   - Database sharding by showroom_id range
   - CDN for static assets
   - Separate analytics database
   - Microservices for heavy operations (report generation, notifications)

---

## 3. MAINTAINABILITY — 8/10

### Strengths

**Clean Separation of Concerns:**
```
Route (definition) → Middleware (cross-cutting) → Controller (thin) → Service (logic) → Prisma (data)
```

**File Organization:**
- Every module has: `routes/<module>.routes.js` + `controllers/<module>.controller.js` + `services/<module>.service.js`
- Easy to find any endpoint's full implementation

**Consistent Naming:**
- `listX`, `getX`, `createX`, `updateX`, `deleteX` for CRUD operations
- `getXStats`, `getXSummary` for aggregated endpoints
- Filenames match module names

**Validation Separation:**
- All Zod schemas in `validations/` directory
- Schema names match route names
- Arabic error messages centralized

**Audit Trail Built-in:**
- Every mutation automatically logged
- Fire-and-forget pattern means no audit-log bugs can break the main operation

### Weaknesses

**No Documentation:**
- `docs/` directory is empty
- No README at project root
- No API documentation (Swagger/OpenAPI)
- No inline documentation in complex functions

**No Tests:**
- Repeat: zero tests. This is the single biggest maintenance risk.
- A new developer cannot safely refactor without manual end-to-end testing

**Backend Language Choice:**
- JavaScript (not TypeScript) for the backend means:
  - IDE autocomplete is limited
  - Refactoring is riskier
  - New engineers need to read more context to understand data shapes

---

## 4. MODULARITY — 8/10

### Module Dependency Graph

```
                    ┌──────────────┐
                    │  Inventory   │
                    │  Service     │
                    └──────┬───────┘
                           │ LOW_STOCK_THRESHOLD
                           ▼
┌───────────┐    ┌──────────────┐    ┌──────────────┐
│ Customers │    │    Sales     │    │  Suppliers   │
│ Service   │    │   Service   │    │   Service    │
└───────────┘    └──────┬───────┘    └──────────────┘
                        │
                        ▼
               ┌────────────────┐
               │  Notification  │
               │    Service     │
               └────────────────┘
                        │
                        ▼
               ┌────────────────┐
               │   Email        │
               │   Service      │
               └────────────────┘
```

### Circular Dependency Check
- No circular dependencies detected
- Sales service references inventory service for `LOW_STOCK_THRESHOLD` constant only (not functions)
- Notification service is called but never calls back into sales/inventory

### Module Boundaries

| Module | Depends On | Depended On By |
|--------|-----------|----------------|
| auth | User model, JWT config | (standalone) |
| inventory | Supplier (optional FK) | Sales (via constant) |
| sales | Inventory, Customer, Notification | Analytics, Invoices |
| analytics | Sales, Inventory, Expenses | Dashboard (frontend) |
| supplier | (standalone) | Inventory (optional FK) |
| customer | (standalone) | Sales (optional FK) |
| notification | (standalone) | Sales, Inventory (triggers) |
| subscription | Showroom | License, SuperAdmin |
| activity | AuditLog | (standalone) |
| search | Inventory, Customer, Supplier, Sales | (standalone) |

---

## 5. SEPARATION OF CONCERNS — 9/10

### Layered Architecture (Backend)

| Layer | Responsibility | Contains | Quality |
|-------|---------------|----------|---------|
| Routes | Define URL, HTTP method, middleware chain | 16 route files | ✅ Excellent |
| Middleware | Cross-cutting: auth, RBAC, license, tenant, validation, cache | 8 middleware files | ✅ Excellent |
| Controllers | Parse request, call service, format response | 17 controllers | ✅ Excellent (except expense.controller) |
| Services | Business logic, transactions, financial calculations | 11 services | ✅ Excellent |
| Validations | Input schemas with Arabic error messages | 5 validation files | ✅ Excellent |
| Config | Environment, database, JWT, security, logger | 5 config files | ✅ Excellent |
| Utils | Response helpers, pagination, date range, invoice numbers | 6 utility files | ✅ Excellent |

### Layered Architecture (Frontend)

| Layer | Responsibility | Contains | Quality |
|-------|---------------|----------|---------|
| Pages | Route definition, data orchestration | 25 page files | ✅ Good |
| Components | UI rendering, user interaction | 14 component files | ✅ Good |
| Hooks | Data fetching, mutation logic, state machines | 5 hook files | ✅ Good |
| Lib | API client, auth store, utilities | 3 lib files | ✅ Excellent |
| Types | TypeScript type definitions | 2 type files | ✅ Good |

### Violation Found
- **expense.controller.js** violates the pattern by having inline Prisma queries (no service layer)
- **Exception:** minor, but inconsistent with the rest of the codebase

---

## 6. TECHNICAL DEBT — Low (Score: 4/10 where lower is better)

### Debt Items Found

| Item | Severity | Effort to Fix | Impact |
|------|----------|---------------|--------|
| Zero tests | HIGH | Large (2-4 weeks) | Highest risk item |
| expense.controller.js inline queries | LOW | 1 hour | Inconsistency only |
| No backend TypeScript | MEDIUM | Large (months) | Ongoing maintenance friction |
| Missing Swagger/OpenAPI | MEDIUM | 1-3 days | No auto-generated API docs |
| No README | LOW | 1 hour | Onboarding friction |
| .env in repo (production creds) | CRITICAL | 1 minute | Security risk — DO NOT COMMIT |
| No CI/CD | MEDIUM | 1 day | No automation |
| No error boundary components | LOW | 2 hours | React error boundaries missing |
| Some pages not fully responsive | LOW | Varies | UX issue on very small screens |

### Most Important Fixes
1. **Remove .env from git tracking** (immediate, critical security)
2. **Add tests for sales.service.js** (highest business value)
3. **Extract expense.service.js** (quick win, pattern consistency)
4. **Add README** (quick win, onboarding)

---

## 7. SAAS READINESS — 8/10

### Already Built for SaaS

| Feature | Status | Notes |
|---------|--------|-------|
| Multi-tenancy | ✅ Complete | AsyncLocalStorage + Prisma extension |
| Subscription/License management | ✅ Complete | Expiry tracking, renewal, grace periods |
| Role-based access (3 tiers) | ✅ Complete | SUPER_ADMIN, OWNER, STAFF |
| Onboarding wizard | ✅ Complete | Guided first-run setup |
| SuperAdmin console | ✅ Complete | Cross-tenant management, impersonation |
| Notification system | ✅ Complete | 8 types, in-app delivery |
| Audit logging | ✅ Complete | Full CRUD audit trail |
| Rate limiting | ✅ Complete | Per-route configurable limits |
| Password reset flow | ✅ Complete | Email-based, SHA-256 hashed tokens |
| Arabic (RTL) interface | ✅ Complete | Full RTL support |

### Missing for Enterprise SaaS

| Feature | Priority | Notes |
|---------|----------|-------|
| SSO / SAML / OAuth | Medium | Enterprise customers expect SSO |
| Billing integration | High | No Stripe/Paddle integration for auto-billing |
| Email notification delivery | Medium | Only in-app notifications (no email for notifications) |
| Team management | Medium | No bulk user invite, no team roles beyond 3 tiers |
| Audit export | Low | No CSV/PDF export of audit logs |
| API tokens | Medium | No API key system for integrations |
| Webhooks | Low | No webhook system for third-party integrations |
| White-label | Medium | No custom domain/branding per showroom |

---

## 8. ENTERPRISE READINESS — 5/10

### Enterprise Features Present
- ✅ Full audit logging
- ✅ Role-based access control (basic)
- ✅ Multi-tenancy
- ✅ Data isolation between branches
- ✅ Comprehensive API

### Enterprise Features Missing
- ❌ SAML/SSO
- ❌ SLA monitoring / uptime guarantees
- ❌ Data export (all data)
- ❌ Bulk operations (users, inventory, customers)
- ❌ Advanced RBAC (groups, custom roles, per-feature permissions)
- ❌ Audit export to external systems
- ❌ Compliance certifications (no SOC2, GDPR readiness unknown)
- ❌ Backup/restore UI
- ❌ API versioning (Vercel deploys may break old clients)
- ❌ Rate limit headers (no Retry-After, X-RateLimit-* headers)

---

## 9. SECURITY REVIEW

### Strengths

| Feature | Implementation | Assessment |
|---------|---------------|------------|
| Multi-tenant isolation | Prisma $allOperations extension with fail-closed | ✅ Excellent |
| Zero-trust tenant context | Rejects client-supplied showroom_id | ✅ Excellent |
| JWT auth | Short-lived access (15m), refresh rotation (7d) | ✅ Excellent |
| Password hashing | bcrypt(12) — 4096 rounds | ✅ Excellent |
| Input validation | Zod schemas on all inputs | ✅ Excellent |
| Rate limiting | Per-route limits, different for auth/sensitive/global | ✅ Excellent |
| Anti-enumeration | Same error for "wrong password" and "user not found" | ✅ Excellent |
| Security headers | Helmet + custom Vercel headers (CSP, HSTS, etc.) | ✅ Excellent |
| Token revocation on password change | Deletes ALL refresh tokens | ✅ Excellent |
| Impersonation audit trails | Impersonation is logged | ✅ Good |
| Environment validation | Crashes on boot if secrets are weak/placeholder | ✅ Excellent |
| Password reset token hashing | SHA-256, never stored raw | ✅ Excellent |

### Vulnerabilities & Issues

**CRITICAL: Production .env in version control**
- `backend/.env` contains real production credentials
- Database URL, JWT secrets, Resend API key, SuperAdmin password
- If this repo goes public or is shared, the entire production database is compromised
- **Fix:** Add .env to .gitignore (it's already there), run `git rm --cached .env` if tracked

**MEDIUM: No CORS origin validation in error case**
- Cors middleware may fall back to `*` if parsing fails
- **Mitigation:** env.validator.js checks ALLOWED_ORIGINS at startup

**MEDIUM: In-memory cache leaks data on cold start**
- Between cold starts, cache is empty (acceptable)
- But if serverless instances overlap, cache inconsistency may serve stale data (acceptable for analytics)

**MEDIUM: No request body size validation per endpoint**
- Global 10mb limit, but no per-route limit
- Bulk create accepts up to 100 items, which is reasonable

**LOW: No API key rotation mechanism**
- If JWT secrets are compromised, no rotation tool exists

**LOW: Logging in production**
- Winston level is 'warn' in production — may miss important debugging info

---

## 10. PERFORMANCE REVIEW

### Current Performance Profile

| Operation | Expected Performance | Bottleneck |
|-----------|---------------------|------------|
| Simple CRUD (single item) | < 50ms | Database round trip |
| Sales listing with joins | < 100ms | Multiple table joins |
| Dashboard KPIs (14 parallel queries) | < 200ms | 14 parallel Prisma queries |
| Analytics charts | < 200ms (cached) -> < 100ms | 60s cache then queries |
| Global search (4 parallel queries) | < 100ms | 4 parallel LIKE queries |
| Create sale (with transaction) | < 200ms | Transaction + inventory deduction |
| Cancel sale (with transaction) | < 200ms | Transaction + inventory restoration |
| Overdue installment scan (cron) | < 5s per 1000 showrooms | Sequential per-showroom |
| Bulk inventory creation (100 items) | < 500ms | 100 individual creates |

### Optimization Opportunities

1. **Analytics queries** — Already has N+1 fixes (top-selling items batch lookup). More could benefit from materialized views.

2. **Activity log listing** — With a composite index already added (`[showroom_id, created_at]`). Good.

3. **Search queries** — Uses `LIKE '%query%'` which cannot use standard B-tree indexes. Consider PostgreSQL trigram indexes (`pg_trgm` extension) for faster text search.

4. **Notification scans** — Currently processes showrooms sequentially. Could batch-process with `limit`/`offset` chunks.

5. **Connection pooling** — Single Neon instance. Add PgBouncer for connection pooling as showroom count grows.

### Query Analysis

| Query | Tables | Type | Optimization |
|-------|--------|------|-------------|
| Dashboard KPIs | sales, inventory, customers, installments, suppliers | 14 parallel aggregate queries | ✅ Parallelized, each query is fast aggregate |
| Top selling items | sale_items + inventory | 1 groupBy + batch inventory lookup | ✅ N+1 fixed |
| Global search | inventory, customers, suppliers, sales | 4 parallel `LIKE` queries | ⚠️ Could use trigram indexes |
| Activity log | audit_logs | Single filtered query | ✅ Composite index on (showroom_id, created_at) |
| Overdue scan | installments + sales | Per-showroom sequential | ⚠️ Sequential, could be batched |

---

## 11. DATABASE REVIEW

### Schema Quality

| Aspect | Assessment |
|--------|-----------|
| Normalization | ✅ 3NF, no redundant data |
| Indexes | ✅ Well-indexed, composite indexes on common query patterns |
| Enums | ✅ 8 enums, consistent naming |
| Relations | ✅ All foreign keys defined, cascade deletes where appropriate |
| Soft Delete | ✅ is_active on inventory, customers, suppliers (not on Sales) |
| Migrations | ✅ 7 migrations, incremental, reversible |
| Constraints | ✅ Unique on (showroom_id, invoice_number), email unique across system |

### Schema Issues

| Issue | Impact | Fix |
|-------|--------|-----|
| No `ON DELETE CASCADE` on sale → customer? | Customer deletion fails if sales exist (intentional guard) | ✅ WAD (Working as Designed) |
| No `ON DELETE CASCADE` on audit_logs → user | Audit trails preserved after user deletion | ✅ WAD |
| `expense.category` is a free-text string | Can't enforce consistent categories | Add enum or reference table |
| `inventory.image_urls` is `String[]` | Supported by PostgreSQL but not by all databases | ✅ WAD for Neon |
| No full-text search indexes | `LIKE '%query%'` on 4 tables for search | Add `pg_trgm` extension |

---

## 12. FRONTEND REVIEW

### Strengths

**Premium UI/UX:**
- Cyberpunk Matrix theme is visually striking and memorable
- Consistent use of glass panels, neon accents, animations (framer-motion)
- Loading states, skeletons, empty states everywhere
- Dark theme reduces eye strain for daily users
- RTL support is complete and consistent

**State Management:**
- Zustand for auth (persisted, cookie bridge for middleware)
- TanStack Query for all server state (caching, deduplication, invalidation, polling)
- No Redux complexity, no prop drilling

**Animation Quality:**
- Staggered list animations, page transitions, modal enter/exit
- Loading spinner animations
- Hover glow effects on cards
- Notification bell pulse animation
- Sidebar active item animation (layoutId)

**Responsive Design:**
- Sidebar: desktop collapsible, mobile off-canvas drawer
- DataTable: horizontal scroll with fade-edge on mobile
- SaleCreateModal: bottom sheet on mobile
- 44px touch targets on mobile

### Weaknesses

**No Error Boundaries:**
- React error boundaries not implemented anywhere
- A single component crash can take down the entire page

**No Loading States on Some Pages:**
- SuperAdmin users page has custom loading but uses different styling from the design system

**No Form Libraries:**
- All forms use manual `useState` handling
- No react-hook-form or formik
- No form validation libraries (validation is manual)
- No auto-save except the manual SaveModeBar pattern

**No Accessibility:**
- No aria-* attributes
- No keyboard navigation beyond the global search
- No screen reader support
- Color contrast may be insufficient for some users (dark theme with neon on dark)

**No i18n Framework:**
- Arabic text is hardcoded throughout
- Adding English or other languages would require a full i18n pass

**No Storybook / Component Library:**
- No isolated component development environment
- No visual regression testing

---

## 13. RECOMMENDED IMPROVEMENTS (Priority Order)

### Priority 1: Critical (Do Now or Risk Business)

1. **Remove .env from git** — Production credentials in version control is a critical security issue
2. **Add tests for sales.service.js** — This is the financial heart of the system. Every calculation must be verified

### Priority 2: High (Next Sprint)

3. **Add tests for inventory.service.js** — Second most critical business logic
4. **Add Swagger/OpenAPI documentation** — Enables auto-generated API docs and client SDKs
5. **Add Stripe/Paddle integration** — Enable automated subscription billing (recurring revenue)

### Priority 3: Medium (Next Month)

6. **Extract expense.service.js** — Pattern consistency
7. **Add React error boundaries** — Prevent full-page crashes
8. **Add README with setup instructions** — Onboarding improvement
9. **Add ESLint + Prettier to backend** — Code consistency
10. **Add pagination to GlobalSearch results** — Currently limited to 5 per entity

### Priority 4: Low (Nice to Have)

11. **Add `pg_trgm` extension for fuzzy search** — Better search performance
12. **Add i18n framework** — Multi-language support
13. **Add CI/CD pipeline (GitHub Actions)** — Automated testing + deployment
14. **Add Storybook** — Component development environment
15. **Add data export (CSV/PDF)** — For reports and audit

---

## 14. KNOWLEDGE TRANSFER PACKAGE

### Where a New Developer Should Start

**Day 1: Project Architecture**
1. Read `backend/src/index.js` — understand server setup, middleware stack, route registration
2. Read `backend/prisma/schema.prisma` — understand all 17 models and their relationships
3. Read `backend/src/config/database.js` — understand multi-tenant isolation (this is the key architectural decision)
4. Read `backend/src/middleware/auth.middleware.js` + `tenant.middleware.js` + `roles.middleware.js` — understand request pipeline

**Day 2: Core Business Logic**
5. Read `backend/src/services/sales.service.js` — the most complex and important service
6. Read `backend/src/services/inventory.service.js` — second most important
7. Read `backend/src/services/analytics.service.js` — understand KPI calculations
8. Read `backend/src/services/notification.service.js` — understand cron scans

**Day 3: Frontend Architecture**
9. Read `frontend/src/lib/api.ts` — understand the API client (1045 lines, the most important frontend file)
10. Read `frontend/src/lib/auth.ts` — understand auth store + impersonation
11. Read `frontend/src/app/layout.tsx` + `middleware.ts` — understand root layout and auth guard
12. Read `frontend/src/components/layout/Sidebar.tsx` — understand navigation structure

**Day 4: Frontend Business Pages**
13. Read `frontend/src/app/dashboard/sales/page.tsx` — sales page workflow
14. Read `frontend/src/app/dashboard/inventory/page.tsx` — inventory management
15. Read `frontend/src/components/sales/SaleCreateModal.tsx` — sale creation flow
16. Read `frontend/src/hooks/useSales.ts` — understand TanStack Query patterns

**Day 5: Security + Operations**
17. Read `backend/src/middleware/validate.middleware.js` — validation pattern
18. Read `backend/src/middleware/audit.middleware.js` — audit trail pattern
19. Read `backend/src/jobs/scheduledNotifications.job.js` — cron coordination
20. Read `backend/src/utils/response.js` — API response standards

### Files Dangerous to Modify

| File | Danger | Why |
|------|--------|-----|
| `database.js` | EXTREME | Breaking multi-tenancy leaks data across customers |
| `tenant.middleware.js` | EXTREME | Same — zero-trust tenant isolation |
| `sales.service.js` | HIGH | Financial calculations, inventory deduction, installment math |
| `inventory.service.js` | HIGH | Stock management, price validation, low-stock alerts |
| `auth.controller.js` | HIGH | Login flow, JWT generation, token rotation |
| `jwt.js` | HIGH | Token secrets, impersonation tokens |
| `invoice.js` | HIGH | Race-condition-free invoice numbering |
| `notification.service.js` | MEDIUM | Cron scans affect all tenants |
| `scheduledNotifications.job.js` | MEDIUM | Distributed locking, multi-instance safety |
| `api.ts` (frontend) | MEDIUM | All API calls, 401 refresh queue, type definitions |

### Files Responsible for Business Rules

| Rule | File(s) |
|------|---------|
| Financial calculations (profit, total) | sales.service.js |
| Inventory deduction/restoration | sales.service.js |
| Installment schedule generation | sales.service.js |
| Sale cancellation blocking (paid installments) | sales.service.js |
| Low stock threshold (qty <= 2) | inventory.service.js (constant), sales.service.js (usage) |
| Selling price >= cost price | inventory.service.js |
| Supplier balance validation | supplier.service.js |
| Invoice number generation (advisory lock) | invoice.js (utils) |
| License expiry enforcement | license.middleware.js |
| Overdue installment detection | notification.service.js |
| Multi-tenant data isolation | database.js, tenant.middleware.js |

### Files Responsible for Permissions & Security

| Security Concern | File(s) |
|-----------------|---------|
| JWT authentication | auth.middleware.js, jwt.js |
| Role-based access control | roles.middleware.js |
| Multi-tenant isolation | tenant.middleware.js, database.js |
| Input validation | validate.middleware.js, all validations/*.js |
| Rate limiting | security.js, index.js (Express rate limit) |
| Environment validation | env.validator.js |
| Password hashing | auth.controller.js (bcrypt) |
| Token hashing (password reset) | superadmin.controller.js (SHA-256) |
| CORS + security headers | index.js (helmet, cors) |
| License enforcement | license.middleware.js |
| Onboarding gate | onboarding.middleware.js |
| SuperAdmin isolation | roles.middleware.js (superAdminOnly) |
| Impersonation security | auth.middleware.js (impersonatedBy), jwt.js (30-min tokens) |
