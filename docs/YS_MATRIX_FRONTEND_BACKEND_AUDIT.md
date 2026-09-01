# YS-Matrix — Frontend/Backend Consistency Audit

**Status:** Discovery / Forensic Audit — Phase 1. Comparison of `frontend/src` against API contracts in `backend/src` (FACT-verified).

---

## 1. Confirmed Alignments (FACT)

| Concern | Status | Evidence |
|---|---|---|
| API base URL wiring | ✅ single source | `lib/api.ts:11` `BASE = NEXT_PUBLIC_API_URL \|\| localhost:5000/api/v1`; invoices page re-declares `API` locally (same env, minor duplication) |
| Endpoint paths | ✅ all match | every `api.ts` function verified against route files (cron/health outside FE) |
| Role gating parity | ✅ | FE `isOwnerPlus`/`isSuperAdmin` mirrors backend `ownerOnly`/`superAdminOnly` (customers page comment cites parity; Sidebar gates superadmin nav; middleware.ts gates `/dashboard/superadmin/*`) |
| Password rules parity | ✅ | FE mirrors 8-128 + confirmation (login/settings/reset pages) |
| Soft-delete UX parity | ✅ | DELETE=deactivate + reactivate buttons only visible for owner (matches ownerOnly backend) |
| Installment payment route | ✅ | `PATCH /sales/installments/:installment_id/pay` matched after fix |
| Invoice print route | ✅ | `GET /invoices/:id/print` matched |
| Sale status `OVERDUE` | ✅ | FE SaleStatus type includes it, matches enum |
| Refresh-token flow | ✅ | 401 singleton queue + redirect matches backend rotation semantics |
| License/session error surfacing | ✅ | `isLicenseExpired`/`isAuthError` codes parsed from backend envelope |
| Analytics cache semantics | ✅ | FE staleTime 60s aligns with backend 60s cache TTL (coincidence of design) |

## 2. Confirmed Inconsistencies / Dead Code (FACT)

### C1 — Root `/` page is a dead duplicate of Settings with a stub save
- `frontend/src/app/page.tsx` duplicates `dashboard/settings/page.tsx` but its `onSave` is `dummySave` (toast only, no API call — page.tsx:17-18). Loading `/` renders a full "settings" UI that silently does nothing on save.
- Backend impact: none; severity UX (LOW/MEDIUM). It also ships to users unaware the "save" is fake.

### C2 — GlobalSearch is implemented in backend but unwired in frontend
- `components/ui/GlobalSearch.tsx` + `searchApi` + hooks exist; **nothing mounts the component** (grep) — Navbar has no search entry. `docs/Matrix.md` advertises "Cmd+K search" — not implemented (see Documentation Audit).
- Backend `GET /api/v1/search` is otherwise complete and tenant-scoped (FACT — search.service.js).

### C3 — Dead notification generator: `PAYMENT_RECEIVED`
- `notification.service.js` defines & exports `notifyPaymentReceived`; **no caller exists** (grep). `supplier.service.js` `addPayment` never notifies (structure.md documents it as firing — contradiction; see Documentation Audit).
- Enum values `PAYMENT_RECEIVED`, `INSTALLMENT_DUE_SOON`, `SYSTEM` are never produced.

### C4 — Notification user-scoping query param undocumented
- Backend `notification.controller.js:24` supports `?mine=true` filtering by user_id; frontend `notificationApi` — FE actually uses it in NotificationCenter? Verified FE calls `getNotifications({mine: true})` in NotificationCenter polling — alignment OK. **Marked infomational** — param exists both sides (no issue).

### C5 — Frontend duplicates some business math
- Sale form computes totals client-side and sends them; backend **recomputes/ignores client totals** (sales.service computes profit; validates items) — the FE numbers are presentation; fine but should be documented (INFORMATIONAL). `SaleCreateModal` builds installment schedule client-side; backend re-creates from validated input (INFORMATIONAL).
- Implications for consistency: FE can show totals the backend will override. No conflict found in acceptance semantics (backend is source of truth).

### C6 — `invoices/[id]` page re-declares its own `API` constant
- Duplicate env reading (`page.tsx:24` vs `lib/api.ts`) — drift risk if env name changes (LOW).

### C7 — Type-drift history acknowledged in comments
- Multiple files cite `next.config.js ignoreBuildErrors: true` as the reason stale types silently shipped (e.g., api.ts comments; inventory field `part_number` added backend-side after frontend had it — documented as "silently vanished" in schema comment). Current state: types updated (FACT — api.ts typed entities match responses).

### C8 — Inactive/recycle pages intentionally parity-consistent
- `customers/inactive` and `suppliers/inactive` comment: backend supports `include_inactive=true`, FE exposures deliberate (parity OK).

### C9 — Frontend polls unread notification count every 60s (backed by `/notifications/unread`)
- Aligned; but multiple tabs each poll (minor duplication; backend cheap) (INFORMATIONAL).

## 3. Validation Parity (FACT)

- Backend: zod strict enough; FE mirrors the main rules (login required fields; password 8+; sale items ≥1; payment note ≤300 mirrored unknowingly via API contract).
- Where FE validates and backend enforces more (e.g., `installment_months ≤ 120`, `first_due_date` future, duplicate inventory item rejection), backend is authoritative — FE errors surface via toast (FACT).
- No backend rule exists that the FE silently bypasses except C5 note (totals recomputation — harmless).

## 4. Error-Handling Parity (FACT)

- FE `ApiRequestError` maps `.code` + Arabic `message` from envelope — consistent consumption.
- Exception: **HTML invoice errors return English** (`'Sale not found'`, `'Failed to fetch invoice'` — invoice.controller.js:37,41) while the rest of the product is Arabic. **Inconsistency (LOW)**; the print 404 returns `<h1>Invoice not found</h1>`.
- License warnings: backend headers + response codes; FE Navbar license badge reads own status (parity OK).

## 5. Feature-Shape Gaps (UI claims vs backend reality)

| UI/page claim | Backend reality | Verdict |
|---|---|---|
| "PDF export" (Matrix.md, market docs) | HTML print only (`window.print()`), no PDF service | **Partial** — print-to-PDF via browser is the stated/marketed feature; acceptable but "PDF" wording is a stretch |
| "CMD+K search" (Matrix.md) | Backend search exists; FE UI unwired | **Not implemented** |
| "Barcode" (`part_number`) | Column + FE input exist; no scanner logic | **Partial** — manual entry only |
| "SMS" (market docs) | no SMS anywhere | **Not implemented** (marketing only) |
| "Multi-branch under one SuperAdmin" | correct: multiple showrooms | ✅ |
| "White label" (market docs) | no white-label code | **Not implemented** |
| Onboarding | full wizard FE+BE | ✅ |
| Impersonation | full flow FE+BE, exit restores session | ✅ |
| Invoice JSON vs HTML | both endpoints work | ✅ |

## 6. Observations for Architecture Review

1. `lib/api.ts` (1045 lines, all endpoints) is the single FE contract — its size is a maintainability concern, but its centralization prevented drift (credit the design).
2. FE uses react-query with 60s staleTime and no optimistic updates on money (only `useSaveMode` optimistic-ish for profile name) — backend remains authoritative; good.
3. The only "business rule enforced solely in frontend" is cosmetic (disable cancel button? verified — cancel respects paid installment: FE blocks cancel attempt if any installment paid? It relies on backend 409/423; FE shows toast from backend. No enforcement gap found.) — the backend remains the gatekeeper everywhere (FACT).
4. **Recommendation:** delete or wire the duplicate `/` page; wire or remove GlobalSearch; align notification generator (decide `PAYMENT_RECEIVED` semantics); add an OpenAPI-derived type generation step once CI exists (future).