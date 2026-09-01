# YS-Matrix — Open Questions for the Lead Architect

**Status:** Discovery / Forensic Audit — Phase 1. Items that cannot be answered from repository evidence (UNCLASSIFIED evidence below each).

---

## A. Business / Product Decisions Needed

1. **Support model** — YS-Matrix has zero built-in support surface; impersonation is the only remote-help tool. Should support surface live inside the product (dashboard link/form, product-tagged email, configurable company contact — `cantactys@gmail.com`, `yssoftware.online`), or stay external? Cross-product identification (YS-Matrix vs YS-Care vs platform) requires an architecture decision (tagging scheme + support routing). *No code exists today (FACT).*

2. **Delegated administration** — future Super Admin / Admin Leader / Admin hierarchy: how many levels, and what does "Admin" mean in the tenant model (system-side operator vs per-showroom manager)? Current roles only: SUPER_ADMIN / OWNER / STAFF (FACT).

3. **STAFF permissions at the POS** — STAFF can currently edit prices, create customers, record supplier payments, create expenses (FACT). Is that desired, or should price/payment/expense mutations be owner-only? (Recommended for a "trust at the counter" business decision.)

4. **national_id exposure** (PII) — who may see customer national IDs and when (list vs detail vs invoice)? Current: all tenant staff + printed on HTML invoice + JSON (FACT).

5. **Multi-owner convention** — multiple OWNERs per showroom are technically possible (SUPER_ADMIN can create them) but the product assumes one owner. Confirm the convention.

6. **MFA/verification roadmap** — no MFA, no email verification today (FACT). Is MFA for SUPER_ADMIN a release blocker for commercial sales? (It gates the impersonation backdoor.)

## B. Engineering / Ops Answers Needed

7. **Production DB** — PostgreSQL on Neon (INFERENCE from deployment shape) — confirm provider, pooling (pgbouncer/Neon pooler config is NOT in the repo; UNKNOWN), backups/RPO policy, and whether `prisma migrate deploy` runs in CI (none exists — UNKNOWN).

8. **Vercel cron + CRON_SECRET** — Vercel's cron job sends the secret as a header per current docs (code comment cites docs); confirm it actually works in the live deployment (the endpoint fails loud if CRON_SECRET is unset — likely set, UNVERIFIED).

9. **Resend domain verification** — from-address default is still `onboarding@resend.dev` (FACT if env doesn't override) — is the domain verified and is FRONTEND_URL-based link building correct in production?

10. **Deployment pipeline** — zero commits, zero CI (FACT). How is the current production deployed/updated today (manual `vercel deploy`?), and is there a plan to start version control? (HIGH-priority question — the repo has no history.)

11. **Secrets hygiene** — production credentials live in local `.env` (gitignored, not committed — not a git leak). Are they also in Vercel env store; is there a rotation procedure? (UNKNOWN)

12. **Cold start & scale target** — target tenant count for next 12 months (drives P1/P3/P5 priorities and the cache/pooling strategy).

13. **Invoice numbering** — format `INV-<SLUG3>-<YEAR>-<SEQ>` per showroom; confirm legal/tax requirements for invoicing in target markets (Arabic numerals used in print via Intl ar — is that compliant with any local e-invoicing regulations? UNKNOWN).

14. **Data retention** — audit_logs and notifications grow forever (only read-notifications >30d are purged; audit rows never purged) (FACT). Retention/compliance policy needed.

15. **Support escalations** — company support email `cantactys@gmail.com` is a personal Gmail; is a product-domain mailbox planned (support@ys-matrix.com style) for the unified support vision? (Business question)

## C. Architecture Decisions to Ratify (for the report review)

16. Single SUPER_ADMIN account — keep as the only platform admin until the delegated model lands? (Current code actively prevents second SUPER_ADMIN — FACT.)

17. In-memory analytics cache vs Redis — ratify TTL-cache acceptability at target scale.

18. S3/object storage roadmap — approve the direction (URL-only today) before any upload feature is built (Security Audit F-notes).

19. OpenAPI contract generation — endorse auto-generating an API spec + FE types from Prisma/controllers when CI lands (to stop type drift without `ignoreBuildErrors`).