# YS-Matrix — Performance Audit

**Status:** Discovery / Forensic Audit — Phase 1. Static analysis; no load tests run (would modify nothing, but none exist in repo).
**Lemma:** confirmed issues (would bite at current/post-likely scale) vs opportunities.

---

## 1. Confirmed Performance Issues

### P1 — Analytics range queries fetch all rows then group in JS (UNBOUNDED)
- **Severity: MEDIUM** (grows with sales volume per showroom; a year-long range = full table scan + JS grouping per request; 60s cache caps repeat cost but first-hit latency scales linearly).
- Evidence: `analytics.service.js` `getRevenueChart`, `getMonthlyComparison`, `getProfitBreakdown` fetch full ranges then `reduce()` in JS; no `take`.
- Fix direction (future): SQL `GROUP BY date_trunc(...)` aggregates.

### P2 — Expense/activity summary & other aggregates are fine; but `getEntityHistory` unlimited
- `activity.service.js` `getEntityHistory` has no `take` — a single entity with a huge audit trail returns everything (MEDIUM-low; audit rows only grow).
- All list endpoints ARE paginated (credit).

### P3 — Full-showroom scans in two cross-tenant analytics paths
- `superadmin.analytics.service.js` loads **all showrooms** (`db.showroom.findMany` no limit) for license-breakdown; `algorithm N+1 fixed` for top showrooms already, but the unlimited fetch scales with tenant count (MEDIUM at multi-hundred tenants).
- `subscription.service.js getSubscriptionSummary` = 4 counts + 1 aggregate (fine).

### P4 — Sequential cron scans
- `runOverdueInstallmentScan` iterates overdue installments one-by-one (`await` per row: notify + update). With **thousands** of overdue rows, the 08:00 run could take minutes (Vercel function timeout risk — serverless functions commonly 60s-300s). (MEDIUM — depends on tenant count.)
- License scan similarly loop-based but bounded by showroom count.

### P5 — Search uses LIKE '%…%' full scans
- `search.service.js` `contains/insensitive` → `ILIKE '%q%'` on brand/model/color/chassis/engine (inventory), name/phone (customers/suppliers), invoice_number/customer name (sales); no trigram/gin index (FACT — schema has none).
- Fine at small scale; **the moment a showroom hits tens of thousands of rows, every keystroke triggers 4 parallel scans** (FE search debounces via react-query keys; still heavy). Also **no per-search rate limit** beyond global (LOW+opportunity).

### P6 — Notification polling per session (60 s)
- Frontend polls `/notifications/unread` per open tab/session; trivial today, linear with sessions (INFORMATIONAL).

## 2. Confirmed Performance Strengths (FACT)

- **N+1 fixed** in `getTopSellingItems` (one groupBy + batched `inventory findMany in ids`) and `topShowrooms` (batch enrichment) — both documented in-file.
- **Composite indexes cover the hot paths**: `sales(showroom_id, sold_at)`, `audit_logs(showroom_id, created_at)`, `inventory(showroom_id, status)`, `installments(due_date, is_paid)`, plus the hand-written **partial index** `idx_inventory_active WHERE is_active=true` for the common active-inventory query.
- **Pagination everywhere** (limits 1–100) — no unbounded list endpoint.
- **Cache middleware** (60s, tenant-scoped, 7 analytics GETs) — reduces repeat analytics cost; X-Cache headers visible.
- Dashboard KPI block runs **14 parallel aggregates** (Promise.all) — no serial waterfall.
- Transactions are scoped tightly (sales create/cancel/pay, supplier payment, license renew); no long-lived tx spans.
- Inventory bulk capped at 100; low-stock capped 50; search capped 5/entity; upcoming installments capped 50.
- Prisma query logging disabled by default (PRISMA_QUERY_LOGGING opt-in — also a security fix).

## 3. Optimization Opportunities (not issues — RECOMMENDATION)

1. Database-side date-trunc grouping for chart endpoints (removes in-JS grouping).
2. Trigram GIN indexes (pg_trgm) on search columns + a search rate limiter.
3. Batch the cron scans (chunked `updateMany`; or SQL-level marking) to respect serverless timeouts — consider Vercel cron max duration verification (UNKNOWN).
4. Replace in-memory cache with a shared store only if multi-instance analytics consistency matters; today's TTL is short and correctness is per-request (INFORMATIONAL: current design is acceptable).
5. `getEntityHistory` `take: 500` + pagination.
6. Paginate `listAllSubscriptions`/`getAllLicenses`/`getAllShowroomsGlobal` — the last two already are paginated (superadmin lists: users paginated; showrooms paginated; licenses `getAllLicenses` appears unpaginated? — verified: `license.controller.getAllLicenses` fetches with summary; minor).
7. FE: dedupe `useSalesSummary` from table queries (already done); consider `refetchInterval` only when tab visible (INFORMATIONAL).

## 4. Scale Assessment (analysis)

- **Current scale (single-digit showrooms, thousands of rows): no issue.**
- **Growth to ~50-100 tenants × 100k+ rows: the top issues are P1 (charts), P3 (SA license scan), P5 (search).** All three have straightforward SQL fixes.
- **Serverless-specific:** cold starts (UNKNOWN), function timeout vs P4, connection pooling (UNKNOWN — no pooling config visible; Prisma on Vercel typically uses pgbouncer/Neon — verify at the architecture level).
- In-memory cache per-instance means cache-hit ratio degrades with concurrency (INFORMATIONAL).

## 5. Evidence Index (file:line)

- analytics.service.js (getRevenueChart/getMonthlyComparison/getProfitBreakdown grouping; getTopSellingItems N+1 fix; dashboard 14-query parallel)
- activity.service.js:80 (getEntityHistory no take)
- superadmin.analytics.service.js (allShowrooms unlimited; N+1 batch fix)
- jobs/scheduledNotifications.job.js (sequential scans)
- search.service.js (`contains/insensitive`; MAX_RESULTS_PER_ENTITY=5)
- schema.prisma (index list incl. partial index note) + migration 20260704140031 (idx_inventory_active raw SQL)
- cache.middleware.js (60s TTL, tenant key)