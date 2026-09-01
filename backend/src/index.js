// ============================================================
// YS-MATRIX ERP — Server Entry Point (Phase 2 Stage 3)
// Changes vs Stage 1:
//   • Added: notification, subscription, search, activity routes
//   • All other config preserved from Stage 1
// ============================================================

'use strict';

require('./config/env').loadEnv();

const logger   = require('./config/logger');
const { validateEnvOrCrash } = require('./config/env.validator');

// ── CRITICAL: validate environment BEFORE anything else boots. ──
// If JWT secrets are missing/placeholder/weak, or DATABASE_URL is
// absent, or production CORS would fall back to localhost — the
// process exits here with a clear message instead of starting in
// an insecure state. This must run before express, before routes,
// before app.listen().
validateEnvOrCrash(logger);

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const morgan    = require('morgan');
const rateLimit = require('express-rate-limit');

const response = require('./utils/response');
const SECURITY = require('./config/security');
// Tenant-scoped client — used by /health?check=db as the DB probe
// ($queryRaw is client-level, untouched by the tenant extension).
const prisma = require('./config/database');

// ── Existing Routes ───────────────────────────────────────────
const authRoutes         = require('./routes/auth.routes');
const showroomRoutes     = require('./routes/showroom.routes');
const onboardingRoutes   = require('./routes/onboarding.routes');
const inventoryRoutes    = require('./routes/inventory.routes');
const supplierRoutes     = require('./routes/supplier.routes');
const customerRoutes     = require('./routes/customer.routes');
const salesRoutes        = require('./routes/sales.routes');
const analyticsRoutes    = require('./routes/analytics.routes');
const invoiceRoutes      = require('./routes/invoice.routes');
const licenseRoutes      = require('./routes/license.routes');
const superAdminRoutes   = require('./routes/superadmin.routes');
const adminRoutes        = require('./routes/admin.routes');

// ── NEW Stage 3 Routes ────────────────────────────────────────
const notificationRoutes = require('./routes/notification.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const searchRoutes       = require('./routes/search.routes');
const activityRoutes     = require('./routes/activity.routes');

// F4 — tenant staff management (OWNER)
const usersRoutes        = require('./routes/users.routes');

// ── Scheduled Jobs (Matrix Audit #12) ──────────────────────────
const scheduledNotificationsJob = require('./jobs/scheduledNotifications.job');

// ── Cron HTTP Trigger (Matrix Audit — Phase 6, Vercel) ─────────
const cronRoutes = require('./routes/cron.routes');

const app        = express();
const PORT       = process.env.PORT || 5000;
const API_PREFIX = `/api/${process.env.API_VERSION || 'v1'}`;

app.set('trust proxy', 1);

// ── Security Headers ──────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production' ? undefined : false,
  hsts: process.env.NODE_ENV === 'production'
    ? { maxAge: 31536000, includeSubDomains: true, preload: true }
    : false,
  noSniff:    true,
  xssFilter:  true,
  frameguard: { action: 'deny' },
}));

// ── CORS ──────────────────────────────────────────────────────
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (SECURITY.cors.allowedOrigins.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: Origin ${origin} not allowed`));
  },
  credentials:    SECURITY.cors.credentials,
  methods:        ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
}));

// ── Rate Limiters ─────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: SECURITY.rateLimit.global.windowMs,
  max:      SECURITY.rateLimit.global.max,
  standardHeaders: true, legacyHeaders: false,
  handler: (req, res) => response.tooManyRequests(res, 'طلبات كثيرة جداً. يرجى المحاولة لاحقاً.'),
});

app.use(globalLimiter);

// ── Body Parsing ──────────────────────────────────────────────
app.use(express.json({ limit: SECURITY.body.limit }));
app.use(express.urlencoded({ extended: true, limit: SECURITY.body.limit }));

if (process.env.NODE_ENV !== 'test') {
  app.use(morgan(process.env.NODE_ENV === 'production' ? 'combined' : 'dev'));
}

// ── Health Check ──────────────────────────────────────────────
// Phase 4C (4C-F4): the base /health is a pure liveness probe
// (process up, config loaded). Production operators ALSO need a
// readiness signal — /health?check=db adds an opt-in DB probe
// (3s timeout, degraded status instead of hanging) so a DB outage
// is visible to uptime monitors instead of looking healthy.
app.get('/health', async (req, res) => {
  const baseHealth = {
    status:    'OK',
    service:   'YS-MATRIX ERP API',
    version:   process.env.API_VERSION || 'v1',
    env:       process.env.NODE_ENV    || 'development',
    timestamp: new Date().toISOString(),
    uptime:    Math.floor(process.uptime()),
  };

  if (req.query.check === 'db') {
    try {
      await Promise.race([
        prisma.$queryRaw`SELECT 1`,
        new Promise((_, reject) => setTimeout(() => reject(new Error('db probe timed out')), 3000)),
      ]);
      return res.json({ ...baseHealth, db: 'up' });
    } catch (err) {
      logger.warn(`[HEALTH] DB probe failed: ${err.message}`);
      return res.status(503).json({ ...baseHealth, status: 'DEGRADED', db: 'down' });
    }
  }

  return res.json(baseHealth);
});

// ── Cron HTTP Trigger (Matrix Audit — Phase 6) ─────────────────
// Deliberately public (no authenticate/tenantGuard — Vercel's cron
// trigger carries no user session) and deliberately OUTSIDE the
// versioned API_PREFIX — this is an internal infra trigger, not a
// public API surface, so it shouldn't move if API_VERSION ever
// changes (vercel.json's `crons` path would otherwise need syncing
// every time too). Protected by CRON_SECRET inside cron.routes.js
// itself, not by any route-level middleware here.
app.use('/api/cron', cronRoutes);

// ── API Routes ────────────────────────────────────────────────
// The auth brute-force limiter (SECURITY.rateLimit.auth) is applied
// per-route inside auth.routes.js to the two ANONYMOUS credential
// endpoints (login, register-account) — NOT here on the whole
// /auth prefix, so /refresh, /me, /logout and /change-password never
// consume the login-attempt budget (Phase 3 — P3-A).
app.use(`${API_PREFIX}/auth`,          authRoutes);
app.use(`${API_PREFIX}/showrooms`,     showroomRoutes);
app.use(`${API_PREFIX}/onboarding`,    onboardingRoutes);
app.use(`${API_PREFIX}/inventory`,     inventoryRoutes);
app.use(`${API_PREFIX}/suppliers`,     supplierRoutes);
app.use(`${API_PREFIX}/customers`,     customerRoutes);
app.use(`${API_PREFIX}/sales`,         salesRoutes);
app.use(`${API_PREFIX}/analytics`,     analyticsRoutes);
app.use(`${API_PREFIX}/invoices`,      invoiceRoutes);
app.use(`${API_PREFIX}/licenses`,      licenseRoutes);
app.use(`${API_PREFIX}/superadmin`,    superAdminRoutes);
app.use(`${API_PREFIX}/admin`,         adminRoutes);

// ── NEW Stage 3 ───────────────────────────────────────────────
app.use(`${API_PREFIX}/notifications`, notificationRoutes);
app.use(`${API_PREFIX}/subscriptions`, subscriptionRoutes);
app.use(`${API_PREFIX}/search`,        searchRoutes);
app.use(`${API_PREFIX}/activity`,      activityRoutes);
app.use(`${API_PREFIX}/users`,         usersRoutes);

// ── 404 ───────────────────────────────────────────────────────
app.use('*', (req, res) =>
  response.notFound(res, `المسار ${req.originalUrl} غير موجود.`)
);

// ── Global Error Handler ──────────────────────────────────────
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.message?.includes('CORS'))          return response.forbidden(res, 'طلب محجوب بسبب سياسة CORS.', 'CORS_BLOCKED');
  if (err.type === 'entity.parse.failed')     return response.validationError(res, null, 'صيغة JSON غير صالحة.');
  if (err.type === 'entity.too.large')        return response.error(res, 'حجم الطلب أكبر من المسموح.', 413);

  logger.error('Unhandled error:', { message: err.message, path: req.path, method: req.method });

  // F-9 FIX: was `NODE_ENV === 'production' ? generic : err.message` —
  // a NEGATIVE check. Any environment that ISN'T exactly 'production'
  // (a misconfigured staging box, NODE_ENV simply left unset on a real
  // deployment, a typo) leaked raw err.message to the client by
  // default — including Prisma errors that can embed column/table
  // names or other internal schema details. Inverted to a POSITIVE
  // whitelist: only the exact string 'development' gets the raw
  // message; every other value (including unset) fails closed to the
  // safe generic response — same fail-closed philosophy already
  // applied to tenant isolation and env validation elsewhere.
  return response.serverError(
    res,
    process.env.NODE_ENV === 'development' ? err.message : 'خطأ داخلي في الخادم.'
  );
});

// ── Start ─────────────────────────────────────────────────────
// Test mode: the harness (tests/helpers/harness.js) boots the app
// on an ephemeral port itself; calling app.listen() here too would
// leave an open handle (PORT=0 in .env.test) and hang the node:test
// runner. Same NODE_ENV==='test' exclusion as morgan and the
// scheduled job above.
const server = process.env.NODE_ENV === 'test'
  ? null
  : app.listen(PORT, () => {
  logger.info(`🚀 YS-MATRIX ERP API running on port ${PORT}`);
  logger.info(`📡 API Prefix: ${API_PREFIX}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`🏢 YS Systems & Software`);
  logger.info(`✅ Stage 3: Notifications, Subscriptions, Search, Activity`);

  // Matrix Audit #12: register the daily notification scan ONLY after
  // the server is actually listening — and never during automated
  // tests (same exclusion pattern already used for morgan above), so
  // CI/test runs don't register a real schedule or touch
  // ScheduledJobRun rows.
  if (process.env.NODE_ENV !== 'test') {
    scheduledNotificationsJob.start();
  }
});

const shutdown = async (signal) => {
  logger.info(`${signal} received — shutting down gracefully`);
  server.close(async () => {
    try {
      const prisma = require('./config/database');
      await prisma.$disconnect();
    } catch (e) { logger.error('DB disconnect error:', e); }
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM',             () => shutdown('SIGTERM'));
process.on('SIGINT',              () => shutdown('SIGINT'));
process.on('unhandledRejection',  (r) => logger.error('Unhandled Rejection:', r));
process.on('uncaughtException',   (e) => { logger.error('Uncaught Exception:', e); process.exit(1); });

module.exports = app;
