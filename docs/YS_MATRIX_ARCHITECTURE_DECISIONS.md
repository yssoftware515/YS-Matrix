# YS-Matrix — Architecture Decision Register

**Status:** Phase 2 planning — BUILD-approved, documentation-only. Short register; only decisions that affect implementation.
**Status values:** APPROVED (architected direction) · DEFERRED (recorded, not implemented now) · OPEN (needs decision during implementation).

| Decision | Direction | Status | Reason |
| --- | --- | --- | --- |
| Backend-authoritative authorization | Backend is the only security boundary; frontend consumes `permissions[]` for UX only | APPROVED | Frontend must never gate security (Phase 1 evidence: all enforcement is middleware/service-side) |
| Permissions + scopes separated | Two independent dimensions; scope never encoded in the permission identifier | APPROVED | Prevents identifier explosion and composite-permission bugs |
| Permission format `resource:action` | Granular identifiers only; no wildcard catalog entries (wildcard = doc shorthand only) | APPROVED | Single decision-relevant unit; wildcards hide omission and drift |
| SUPER_ADMIN non-delegable | System authority, not a permission bundle; no admin creates/promotes/grants/modifies it | APPROVED | Single-account compromise containment; mirrors existing 5 boundary guards |
| No privilege amplification | Grant service enforces permission-subset + scope-containment + role-boundary in one transaction | APPROVED | Prevents escalation through delegation; race-protected |
| Permission-defined platform administrators | Profiles = role rows bundling granular permissions (e.g., Platform Client Admin, Platform Support Admin) | APPROVED | No enum role explosion; capabilities composed from one catalog |
| `/admin/*` frontend surface | New route group, permission-aware rendering, backend-driven | APPROVED | Keeps admin UX separate from tenant dashboard; never a security gate |
| Showroom remains tenant boundary | License, subscriptions, users, and operational data stay showroom-scoped; no schema/isolation change | APPROVED | Verified three-layer isolation is the working model; don't redesign what works |
| Client entity deferred | No `Client` table/scope schema now; `CLIENT` scope slot is additive later | DEFERRED | No current requirement; deferral costs nothing architecturally |
| Structured support contact | In-app form → product-stamped structured email (YS-Matrix + category/module/version) → existing inbox | APPROVED | Smallest correct flow; no ticket system; aligns product family without shared infra |
| MFA in hardening phase | TOTP + recovery codes (RFC 6238) in Phase 4, mandatory-or-step-up for SUPER_ADMIN | APPROVED | No MFA exists today; sequenced after authorization foundation, not before |
| Conservative/no-cache authorization | Resolver reads identity + assignment from DB per request; no permission cache | APPROVED | Scale doesn't require caching; avoids stale-authorization class; revisit only with profiling evidence |
| Git baseline | Baseline commit before any change (Phase 0) | APPROVED | No git history today; every later phase needs a revert point |
| Authorization/regression testing | Phase 0 harness + parity suite + per-phase tests mandatory before each gate | APPROVED | Zero tests today; protective suite is the gate for all later phases |
| Resolver = single decision engine | Extend `roles.middleware.js` into central resolver; OWNER/STAFF via compatibility mapping; no dual engines | APPROVED | One code path for decisions; parity verified by suite; reversible via flag |
| Impersonation: step-up gating | Step-up (MFA) to start; session nonce; in-UI state; nested banned; sensitive ops restricted | APPROVED | Keeps proven 30-min model; closes abuse paths |
| Read-only mode for support impersonation | Whether impersonation may run read-only | OPEN | Decide in Phase 4 with real support needs |
| Mandatory MFA policy scope | Mandatory for SUPER_ADMIN only, or also platform admins/tenants | OPEN | Decide in Phase 4 with rollout plan |
| Legacy `/dashboard/superadmin/*` handling | Redirect vs. migrate to `/admin/*` | OPEN | Low risk; decide during Phase 2 |

_Registered 2026-08-09. Revisit: only on new verified requirements or at phase gates._