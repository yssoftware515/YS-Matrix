# Backup & Restore Runbook (Neon PostgreSQL)

Production database: **Neon PostgreSQL** (multi-tenant, single database).
Scope: the `ys-matrix` database used by the Vercel-deployed backend.

## Capability summary

| Capability | Neon | Our standing policy |
|---|---|---|
| Automated daily backups | Yes (platform-managed) | Ensure the branch has the paid plan with PITR enabled |
| Point-in-Time Recovery | Yes, 1–30 days depending on plan | **RPO target: 1 day** (daily backup floor) |
| Manual snapshot | Yes (`neonctl branches create` or Console) | Before every migration / risky operation |
| Restore | New branch → point DNS or `psql` restore | See below |

The platform does the daily backups automatically; this runbook is about
(1) verifying they exist, (2) taking a manual snapshot before changes, and
(3) restoring when something goes wrong. No custom backup scripts are
needed — adding our own file dumps would duplicate the platform's PITR
with no extra safety (and could drift stale).

## 1. Verify daily backups (quarterly, and before any release)

```
neonctl branches list
neonctl branches get <main-branch-id> --show-detail
```

Pass: the branch shows an active backup schedule (Neon plans with PITR
retain at least 1 day). Also confirm the project's **paid plan** is
active — the free tier's limited retention is NOT a backup guarantee.

## 2. Manual snapshot before a release / migration (MIG-01 gate)

```
# Create a named branch as a point-in-time snapshot (read-only guard)
neonctl branches create --name pre-release-2026-08-14 --type read_only
```

Pass: branch appears in the Console list. Keep it until the release is
declared healthy (≥ 1 week), then delete it:

```
neonctl branches delete pre-release-2026-08-14
```

Also run `npm run db:migrate:prod` only after the snapshot exists.

## 3. Restore (disaster drill)

Scenario A — **schema/migration went wrong**: restore is "point the app at
a pre-migration branch" or `psql` restore from the snapshot:

```
# From the snapshot branch, dump
pg_dump "postgresql://<user>@<snapshot-host>/neon?sslmode=require" > restore-2026-08-14.sql
# Into the repaired main database
psql "postgresql://<user>@<main-host>/neon?sslmode=require" < restore-2026-08-14.sql
```

Scenario B — **data loss / corruption**: use Neon Console → Branch →
"Restore to point in time" (pick the timestamp before the incident).

After ANY restore:

1. `prisma migrate status` — confirm schema matches the restored data.
2. Run `npm run db:seed:plans` — the plan catalog is idempotent; a
   restored older DB may predate it.
3. Spot-check: `GET /api/v1/subscriptions/plans`, one showroom's sales
   list, audit panel.
4. Rotate the database password (restores often touch connection
   strings in logs/PRs).

## 4. Restore drill (quarterly, 30 min)

1. Create a throwaway branch from main.
2. Restore its data into a scratch schema on a dev DB.
3. Verify: plans present, a known showroom's rows intact, login works
   with the scratch connection string.
4. Delete the branch.

Pass criterion: the drill completes in < 30 min with no unresolved
inconsistencies — the same steps a real disaster will need under time
pressure.

## Non-negotiable

- Never run `db:reset` / destructive SQL against the production DB.
- Never rely on the free-tier retention for the launch period.
- The migration list must stay in sync with `prisma/migrations` — apply
  only via `prisma migrate deploy` (never hand-written DDL on prod).