# YS-Matrix Deployment Runbook

Step-by-step guide for deploying YS-Matrix ERP to production on Vercel.

---

## Prerequisites

- [ ] Vercel CLI installed (`npm i -g vercel`)
- [ ] GitHub repo connected to Vercel
- [ ] PostgreSQL database provisioned (Vercel Postgres, Neon, or Supabase)
- [ ] Database migration completed (see Step 2 below)
- [ ] All environment variables generated and ready (see Step 1)

---

## Step 1: Environment Variables

### Frontend (Vercel Project → Settings → Environment Variables)

Set these in the Vercel dashboard for the frontend project. All frontend variables use the `NEXT_PUBLIC_` prefix.

| Variable | Required | Description | Example |
|---|---|---|---|
| `NEXT_PUBLIC_API_URL` | Yes | Backend API base URL | `https://api.yourdomain.com/api/v1` |
| `NEXT_PUBLIC_SUPPORT_EMAIL` | No | Support email shown on Settings page | `support@ys-matrix.com` |

### Backend (Server host / Vercel Serverless)

Set these on your backend hosting environment. The backend validator on startup (`env.validator.js`) will crash if required production variables are missing.

#### Required in ALL Environments

| Variable | Required | Description | Example |
|---|---|---|---|
| `DATABASE_URL` | Yes | PostgreSQL connection string (must include `?schema=public`) | `postgresql://user:pass@host:5432/dbname?schema=public` |
| `JWT_ACCESS_SECRET` | Yes | 64-char random secret for access tokens | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"` |
| `JWT_REFRESH_SECRET` | Yes | 64-char random secret for refresh tokens (MUST be different from access secret) | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"` |

#### Required ONLY in Production (`NODE_ENV=production`)

| Variable | Required | Description | Example |
|---|---|---|---|
| `ALLOWED_ORIGINS` | Yes | Comma-separated frontend URLs. Must NOT contain `localhost`. | `https://ys-matrix.vercel.app,https://www.yourdomain.com` |
| `CRON_SECRET` | Yes | Secret for cron trigger endpoint (`/api/cron/*`). Must pass 32-char strength gate. | Generate: `node -e "console.log(require('crypto').randomBytes(64).toString('base64'))"` |

#### Optional / Defaults Apply

| Variable | Required | Description | Default |
|---|---|---|---|
| `NODE_ENV` | No | Set to `production` | `development` |
| `PORT` | No | Server listen port | `5000` |
| `API_VERSION` | No | API version prefix | `v1` |
| `JWT_ACCESS_EXPIRES` | No | Access token lifetime | `15m` |
| `JWT_REFRESH_EXPIRES` | No | Refresh token lifetime | `7d` |
| `BCRYPT_ROUNDS` | No | Password hash rounds (4-15 safe range) | `12` |
| `RATE_LIMIT_WINDOW_MS` | No | Global rate limit window (ms) | `900000` (15 min) |
| `RATE_LIMIT_MAX` | No | Global rate limit max requests per window | `300` |
| `SYSTEM_SHOWROOM_ID` | No | SuperAdmin system showroom ID (do not change after seed) | `system-showroom-001` |
| `EMAIL_TRANSPORT` | No | Email transport type (`resend` or `console`) | `resend` |
| `RESEND_API_KEY` | No | Resend API key for email sending (required if `EMAIL_TRANSPORT=resend`) | — |
| `FRONTEND_URL` | No | Frontend URL for password reset links | — |
| `LOG_LEVEL` | No | Winston log level | `info` |

#### Seed-Only Variables (not needed at app runtime)

| Variable | Required | Description |
|---|---|---|
| `SUPER_ADMIN_EMAIL` | Only for `db:seed` | SuperAdmin login email |
| `SUPER_ADMIN_PASSWORD` | Only for `db:seed` | SuperAdmin login password (must pass strength gate) |
| `SUPER_ADMIN_NAME` | Only for `db:seed` | SuperAdmin display name |

---

## Step 2: Database Migration

**CRITICAL:** Always use `prisma migrate deploy` for production. Never use `prisma migrate dev`, `prisma migrate reset`, or `prisma db push`.

### Option A: Vercel Build Step (Recommended)

Add a Build Step in Vercel that runs before your app starts:

```bash
npx prisma migrate deploy
```

### Option B: Run Manually Before First Deploy

```bash
# Set DATABASE_URL in your shell first
export DATABASE_URL="postgresql://user:pass@host:5432/dbname?schema=public"

# Run migrations
npx prisma migrate deploy

# Seed the database (first deploy only)
node src/utils/seed.superadmin.js
node src/utils/seed.demo.js
node src/utils/seed.plans.js
```

### What `prisma migrate deploy` Does

- Applies all pending migrations in order
- Does NOT create new migrations (that's `prisma migrate dev` — local only)
- Does NOT reset or drop data (that's `prisma migrate reset` — NEVER for production)
- Is safe to run multiple times (idempotent)

### Seeding (First Deploy Only)

The seed scripts create:
1. **SuperAdmin** user (required for initial access)
2. **Demo data** (optional — sample showroom, users, items)
3. **Plans** (subscription plans)
4. **Authorization data** (roles and permissions)

---

## Step 3: Vercel Build Settings

Configure in the Vercel Dashboard under your frontend project's Settings → General:

| Setting | Value |
|---|---|
| **Root Directory** | `frontend` |
| **Build Command** | `npm run build` |
| **Output Directory** | `.next` |
| **Node.js Version** | `18.x` or `20.x` |

### Security Headers

Security headers are already configured in `frontend/vercel.json`:
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: DENY`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()`
- `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`
- `X-DNS-Prefetch-Control: on`
- Static asset caching: `Cache-Control: public, max-age=31536000, immutable`

---

## Step 4: Backend Deployment

YS-Matrix backend is an Express.js server. Deploy to your preferred host.

### Vercel Serverless Functions

If deploying backend as Vercel Serverless Functions:
1. Ensure `postinstall` script runs `prisma generate` (already configured in `backend/package.json`)
2. Set `NODE_ENV=production` in environment variables
3. Set `DATABASE_URL` to your production database connection string

### Dedicated Node Host (Railway, Render, Fly.io, etc.)

```bash
# Install dependencies
npm ci

# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Start the server
npm start
```

The `postinstall` script in `backend/package.json` automatically runs `prisma generate` after `npm install`.

### Health Check Endpoint

Once deployed, verify the backend is running:

```bash
curl https://your-backend-url/api/health
# Expected: {"status":"ok","timestamp":"..."}
```

---

## Step 5: Post-Deployment Smoke Tests

Run this 5-minute checklist immediately after every deployment.

### Smoke Test Checklist

| # | Test | How to Verify | Pass Criteria |
|---|---|---|---|
| 1 | **Health Check** | `curl https://your-backend-url/api/health` | Returns `{"status":"ok",...}` with HTTP 200 |
| 2 | **Frontend Loads** | Open `https://yourdomain.com` in browser | No 404s, no hydration errors in console, login page renders |
| 3 | **Login Flow** | Enter valid credentials on login page | Session created, redirected to dashboard, no errors |
| 4 | **Protected Action** | Create a dummy user or showroom | Action succeeds, data persists, no 401/403 errors |
| 5 | **Security Headers** | Open DevTools → Network tab → inspect response headers | `X-Content-Type-Options`, `X-Frame-Options`, `Strict-Transport-Security` all present |

### Additional Checks

- [ ] Verify CORS: open browser DevTools → Console → check for CORS errors
- [ ] Verify rate limiting: spam the login endpoint — expect 429 after threshold
- [ ] Check email delivery: trigger a password reset flow if `RESEND_API_KEY` is set
- [ ] Verify database connection: create and retrieve a record through the UI

---

## Rollback Procedure

If something goes wrong after deployment:

1. **Immediate:** Revert to the previous Vercel deployment in the Vercel Dashboard (Deployments → click "Promote to Production" on the last known good deployment)
2. **Database:** If a migration caused issues, restore from your database provider's backup (do NOT run `prisma migrate reset` on production)
3. **Verify:** Run the smoke test checklist against the rolled-back deployment

---

## Troubleshooting

| Symptom | Likely Cause | Fix |
|---|---|---|
| App crashes on startup with "ENVIRONMENT VALIDATION FAILED" | Missing or weak env vars | Check the error message — it lists every invalid variable |
| `NEXT_PUBLIC_API_URL` not working | Frontend can't reach backend | Verify the URL is correct and includes `/api/v1` |
| CORS errors in browser console | `ALLOWED_ORIGINS` missing or includes `localhost` | Set `ALLOWED_ORIGINS` to your production frontend URL(s) |
| `prisma migrate deploy` fails | Database unreachable or credentials wrong | Verify `DATABASE_URL` is correct and the database server is running |
| 401 errors on authenticated requests | JWT secrets are different between deploys | Ensure `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` are consistent across deployments |
| Rate limiting blocks production users | `RATE_LIMIT_MAX` too low for shared-NAT | Raise `RATE_LIMIT_MAX` (default 300) in environment variables |

---

## Environment Variable Sync Checklist

Before every deploy, verify:

- [ ] `backend/.env.example` matches the runbook tables above
- [ ] `frontend/.env.example` matches the runbook tables above
- [ ] All production env vars are set in Vercel / hosting provider dashboard
- [ ] No placeholder values remain in production (`GENERATE_STRONG_64_CHAR_SECRET_HERE`, `enter strong pass`, etc.)
