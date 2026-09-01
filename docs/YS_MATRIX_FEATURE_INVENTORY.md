# YS-Matrix — Feature Inventory

**Status:** Discovery / Forensic Audit — Phase 1. Traced through FE→API→service→DB for every feature (FACT).
**Status labels:** IMPLEMENTED (full stack verified) · PARTIAL (some layer missing) · DEAD/UNUSED (code exists, unreachable) · BROKEN (verified failing path) · NOT IMPLEMENTED (docs/marketing only) · UNKNOWN.

---

## 1. Verified Feature Inventory

| # | Feature | Status | Evidence trail |
|---|---|---|---|
| 1 | Authentication (login/logout/refresh/me) | IMPLEMENTED | POST /auth/login + refresh rotation + FE forms |
| 2 | Change password | IMPLEMENTED | PUT /auth/change-password; revokes all sessions |
| 3 | Self-service password reset | IMPLEMENTED | forgot-request + reset (rate-limited, hashed tokens, email via Resend) |
| 4 | SuperAdmin password reset for users | IMPLEMENTED | /superadmin/reset-user-password + requests view |
| 5 | Onboarding wizard | IMPLEMENTED | GET/PATCH /onboarding + /dashboard/onboarding page + middleware gate |
| 6 | Showroom management (SA) | IMPLEMENTED | /showrooms CRUD+stats; creates owner+subscription atomically |
| 7 | SuperAdmin user management | IMPLEMENTED | /superadmin/users CRUD-ish (create/update/view), impersonation |
| 8 | Impersonation | IMPLEMENTED | 30m token flow + FE session swap/exit |
| 9 | System analytics (SA) | IMPLEMENTED | /superadmin/system-stats |
| 10 | Inventory CRUD + bulk + stats | IMPLEMENTED | /inventory/* + FE page (incl. bulk ≤100) |
| 11 | Inventory soft-delete/recycle | IMPLEMENTED | is_active + /inactive page + reactivate (ownerOnly) |
| 12 | Low-stock alerts | IMPLEMENTED | threshold=2, service + notification + FE low-stock view |
| 13 | Suppliers + payments vs balance | IMPLEMENTED | /suppliers + /:id/payments; overpayment rejected |
| 14 | Customers CRUD + soft-delete | IMPLEMENTED | /customers/* + inactive page |
| 15 | Sales (cash) | IMPLEMENTED | createSale tx; invoice numbers advisory-lock; FE modal |
| 16 | Sales (installment) | IMPLEMENTED | schedule generation, first_due_date rules, FE numbers mirrored |
| 17 | Sale cancellation with stock restore | IMPLEMENTED | ownerOnly; paid-installment fail-closed |
| 18 | Installment payment + completion | IMPLEMENTED | pay endpoint; COMPLETED when none left; OVERDUE recompute |
| 19 | Installment overdue/upcoming dashboards | IMPLEMENTED | /sales/overdue, /upcoming + FE pages |
| 20 | Invoices (JSON + HTML print) | IMPLEMENTED | /invoices/:id + /print (XSS caveat — Security F1) |
| 21 | Expenses CRUD | IMPLEMENTED | under /analytics/expenses; FE page |
| 22 | Analytics dashboard (KPIs/charts) | IMPLEMENTED | 7 cached GETs + recharts FE |
| 23 | In-app notifications (kinds) | IMPLEMENTED* | SALE_CREATED, SALE_CANCELLED, LOW_STOCK, INSTALLMENT_OVERDUE, LICENSE_EXPIRING generated; **PAYMENT_RECEIVED/SYSTEM/INSTALLMENT_DUE_SOON dead enum values** |
| 24 | Notification center w/ unread badge | IMPLEMENTED | FE 60s polling of /unread; read/read-all/delete-old |
| 25 | License/subscription status + renew | IMPLEMENTED | /licenses, /subscriptions (SA renew path) |
| 26 | License expiry warnings (cron) | IMPLEMENTED | 30/7/1-day thresholds, single-fire guards |
| 27 | Activity/audit log viewer | IMPLEMENTED | /activity/* ownerOnly; FE page |
| 28 | Global search | PARTIAL | backend complete; **FE unwired (component dead — C2)** |
| 29 | Profile edit (name) + avatar_url | PARTIAL | name wired end-to-end; avatar_url in API/state but **no upload/UI control (URL field only)** |
| 30 | Barcode spare-part field | PARTIAL | `part_number` column + FE input; no scanner integration |
| 31 | PDF export | PARTIAL | browser print of HTML (no server-side PDF) |
| 32 | PWA | PARTIAL | manifest + icons + SplashScreen; **no service worker** → not installable offline (FACT) |
| 33 | Email (transactional) | PARTIAL | password-reset only; no notification emails, no marketing emails |
| 34 | Sales summary/analytics filters | IMPLEMENTED | summary endpoint excludes CANCELLED (fix) |
| 35 | Search-agnostic pagination | IMPLEMENTED | everywhere paginated 1-100 |
| 36 | Payment integrations (Stripe) | NOT IMPLEMENTED | docs only |
| 37 | SMS / WhatsApp | NOT IMPLEMENTED | docs only |
| 38 | Multi-language | NOT IMPLEMENTED | hardcoded Arabic |
| 39 | White-label | NOT IMPLEMENTED | docs only |
| 40 | Rate limiting / security headers | IMPLEMENTED | global + per-flow limiters; helmet |
| 41 | Audit logging | IMPLEMENTED | full trail + entity history |
| 42 | Root `/` page | DEAD/DUPLICATE | duplicate settings with stub save (C1) |

## 2. Feature Detail — Money Paths (FACT)

- **Sale math**: `profit = Σ(qty × (unit_price − cost_price)) − discount` computed in service; totals stored DECIMAL(12,2); inventory decremented; `qty===0 → SOLD`.
- **Installment generation**: `down_payment < total` enforced by zod superRefine; monthly schedule created with `first_due_date` (future).
- **Supplier payments**: reject when `amount > outstanding`; `total_paid` increment + ledger row in one tx.
- **Expense**: amount DECIMAL(12,2), no category enum (free text) — flag for future.

## 3. Broken / Risky Paths (none confirmed as crashing — caveats only)

- F1 (invoice HTML XSS) — security defect, not a crash (see Security Audit).
- C1 root page stub save — silent no-op UX bug (works but lies).
- `getEntityHistory` unbounded (perf, not broken).
- Notification writers are fire-and-forget: a crashed process can drop notifications (LOW).

## 4. Working-Memory Gaps (UNKNOWN)

- Whether Vercel actually sends the CRON_SECRET header as configured (docs say match current Vercel behavior; **UNVERIFIED from repo**).
- Whether Resend key is valid/domain verified (from-address default still `onboarding@resend.dev` → emails may be flagged; UNKNOWN).
- Real usage volumes for the running deployment (UNKNOWN).
- Which DB is used in prod (Neon pooling config absent from repo; UNKNOWN).

## 5. Feature-Ready Summary

Operationally, YS-Matrix is a **feature-complete v1.5-2.0 ERP** for a single-showroom-per-license model with a functioning platform admin console. The PARTIAL items (search UI, barcode, PDF, PWA, email breadth) are the natural next-release candidates — but per instructions, nothing is implemented in this phase.