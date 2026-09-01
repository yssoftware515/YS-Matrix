# YS-Matrix — Documentation Audit

**Status:** Discovery / Forensic Audit — Phase 1. Existing docs compared against verified code reality.

Existing docs: `docs/` contains 5 files (FACT). **No README anywhere** (root, backend, frontend — glob zero matches; `architecture-review.md` itself says so, and that claim is still TRUE).

---

## 1. Per-Document Assessment

### docs/Matrix.md (386 lines) — Business/strategy canvas
- **Useful**: vision, personas, feature catalog (28 featured + workflow descriptions), metrics table.
- **Accurate claims**: PWA-ish branding? partially; SOP flow describes license warning semantics correctly; "v2.0.0 active development" (unverifiable externally — UNKNOWN).
- **Inaccurate**: "Database Tables: **17**" (actual 16 — FACT); test LOC 0 ✓; enums 8 ✓; notifications "8 types" ✓ enum-count but only 5 produced (see Feature Inventory).
- Verdict: **RETAIN (update metrics), it's the product bible.**

### docs/structure.md (788 lines) — Technical map
- **Useful**: folder tree, middleware pipeline, API map (matches code — verified index.js/route files), env table (SYSTEM_SHOWROOM_ID default matches), 16-model table.
- **Inaccurate/contradictions (FACT)**:
  1. Line 229: "`docs/` # Empty documentation directory" — **false** (5 files live here).
  2. Line 48: "17 models" — 16.
  3. Notification/Event map: "`PAYMENT_RECEIVED` — Fired by supplier.service.addPayment" — **never fired; `notifyPaymentReceived` has no callers** (verified grep).
  4. Env var section otherwise aligns.
  5. Cron endpoint + CRON_SECRET description accurate.
- Verdict: **RETAIN + UPDATE (fix 4 lines); strongest existing technical doc.**

### docs/architecture-review.md (614 lines) — Scoring review
- **Useful**: architecture scoring (7/10), module graph, dependency review, performance table, DB review, KT material — genuinely good prior art.
- **Outdated/inaccurate (FACT)**:
  1. Line 152: "docs/ is empty" — false.
  2. Lines 261/351-354: "CRITICAL — `.env` in repo (production creds)" — **outdated**: `.env` is gitignored and untracked (verified `git ls-files` / `.gitignore`). On-disk presence ≠ committed. The risk was real at some earlier point (probably pre-gitignore) and is now mitigated — the doc still says CRITICAL.
  3. "17 models" (line 539) — 16.
  4. Zero tests ✓, 7 migrations ✓, bcrypt 12 ✓, JWT 15m/7d ✓, "email only for password reset" ✓.
- Verdict: **RETAIN + UPDATE (remove outdated CRITICAL, fix counts); treat as living review, not gospel.**

### docs/market-positioning.md (331 lines) — Sales asset
- Marketing math; competitor matrix; pricing scripts.
- Tech claims to reconcile (FACT): "PWA ready" (no SW — partial), "barcode-ready" (column exists — OK), "white-label ready" (no code), "PDF export" (browser print), "SMS" (none), "10+ dealers already using" (unverifiable marketing — UNKNOWN).
- Verdict: **RETAIN as sales doc; add a "capability truth table" for sales to avoid overpromising.**

### docs/pricing-analysis.md (477 lines) — Monetization
- Pricing tiers, revenue projections, build estimate (~1,150h), Stripe recommendation (not integrated ✓), SMS add-on pricing (not implemented ✓).
- Verdict: **RETAIN; update when payments/SMS ship.**

---

## 2. Support/Contact Functionality in the Product (FACT — grep of all code)

| Surface | Exists? | Evidence |
|---|---|---|
| Contact/support form | **NO** | no route, no page, no component |
| Email links (mailto:) | **NO** | no mailto in code (only invoice footer branding + email template footer) |
| WhatsApp links | **NO** | |
| External support links | **NO** | |
| Product identification in support messages | **N/A** (no support messages) | invoice/email templates say "YS-MATRIX" + "YS Systems & Software" (branding, not support routing) |
| Configurable support contact | **NO** | no env var, no settings field |
| SuperAdmin impersonation (troubleshooting) | **YES** | the only "support tool" — documented in Matrix.md as the support mechanism |

**Conclusion for Lead Architect (no implementation):** YS-Matrix today routes support the "traditional" way — the company's existing support channels, with impersonation as the remote-help mechanism. The unified multi-product support identification the business wants (which product generated request) has **zero current surface**; when built, sensible anchors exist: (a) email templates already carry YS-MATRIX branding and a footer — a shared support-from footer could declare `product=ys-matrix`; (b) the Resend from-address is configurable per deployment; (c) audit logs already tag tenant+actor for a support ticket context; (d) a support page could be added to the dashboard footer with `product` context in query params. Recommended architecture for the future: a shared support inbox/subdomain per product (e.g., support@ys-matrix…, support@ys-care…) with headers/subjects carrying product IDs, plus a link in Navbar/footer — deferred for the Lead Architect's decision.

---

## 3. Documentation Recommendations Summary (retain/update/archive)

- **RETAIN + minor update**: Matrix.md (metrics), structure.md (4 lines), architecture-review.md (remove outdated CRITICAL), market-positioning.md (capability truth table), pricing-analysis.md (sync w/ features).
- **ARCHIVE consideration (do not delete in this phase)**: none obsolete outright; all five have value.
- **MISSING docs that should exist eventually**: README.md (root), DEPLOYMENT.md, SECURITY.md, API reference (OpenAPI), RUNBOOK (cron, seeds, impersonation), ROADMAP alignment doc. `docs/` mentions "DEPLOYMENT.md conventions" in code comments (env.validator.js:29 references DEPLOYMENT.md — **file does not exist**; code-comment stale reference — minor).

## 4. Documentation ↔ Code Contradiction Register (consolidated)

| # | Claim (doc) | Reality (code) | Severity |
|---|---|---|---|
| D1 | 17 tables/models | 16 (FACT) | LOW |
| D2 | docs/ empty | 5 files | LOW |
| D3 | PAYMENT_RECEIVED fired by addPayment | never fired | MEDIUM (misleads notification planning) |
| D4 | `.env` committed = CRITICAL | gitignored+untracked | MEDIUM (outdated alarm) |
| D5 | cron job "not yet wired in" (job file header) | wired at index.js:196 | LOW |
| D6 | PWA-ready / white-label / SMS claims | absent from code | MEDIUM (sales overpromise) |