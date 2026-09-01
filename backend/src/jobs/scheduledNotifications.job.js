// ============================================================
// YS-MATRIX ERP — Scheduled Notifications Job (Matrix Audit #12)
// ============================================================
//
// Runs the cross-tenant notification scanners
// (notification.service.js's runOverdueInstallmentScan,
// runLicenseExpiryScan, Phase 4's runSubscriptionExpiryScan) plus the
// F3 stale-request cancellation scan (lifecycle service's
// runStaleRequestExpiryScan) once daily.
//
// MULTI-INSTANCE SAFETY
// ----------------------
// node-cron has NO built-in awareness of other processes — if this
// file is required in more than one running Node process at the same
// time (PM2 cluster mode, multiple containers, horizontal scaling),
// every instance fires its own copy of the schedule simultaneously,
// and the scan would run (and notify) once PER INSTANCE.
//
// claimRun() below closes that gap using ONLY PostgreSQL — no Redis,
// no external lock service, nothing beyond what YS-MATRIX already
// depends on. ScheduledJobRun has a `@@unique([job_name, run_key])`
// constraint (see schema.prisma). Every instance attempts the SAME
// INSERT for the SAME run_key; only one INSERT can ever succeed —
// Postgres itself is the arbiter, not any in-process flag. Every
// other instance's INSERT fails with Prisma's documented unique-
// constraint error code (P2002), and that instance skips the run.
//
// This makes the job correct TODAY (single instance) and correct
// LATER if YS-MATRIX ever scales horizontally — no code change needed
// when that happens.
// ============================================================

'use strict';

const cron   = require('node-cron');
const prisma = require('../config/database');
const logger = require('../config/logger');
const notificationService = require('../services/notification.service');
const lifecycleService    = require('../services/subscription.lifecycle.service');

const JOB_NAME = 'daily_notification_scan';

/**
 * Attempts to claim the right to run `jobName` for `runKey`.
 * Returns true if THIS call won the claim, false if another
 * instance (or an earlier run) already claimed it.
 */
const claimRun = async (jobName, runKey) => {
  try {
    await prisma.scheduledJobRun.create({
      data: { job_name: jobName, run_key: runKey },
    });
    return true;
  } catch (err) {
    // P2002 = Prisma's unique-constraint-violation code. This is the
    // EXPECTED outcome when another instance won the race — not an
    // error condition. Anything else is a real, unexpected DB problem
    // and must surface, not be silently swallowed.
    if (err?.code === 'P2002') return false;
    throw err;
  }
};

/**
 * The actual work, gated behind the claim above. Exported separately
 * from start() so it can also be triggered manually (e.g. an admin
 * "run now" endpoint, or a one-off backfill) without waiting for the
 * schedule.
 */
const runDailyNotificationScans = async () => {
  // UTC calendar date as the run_key — e.g. "2026-06-27". Using the
  // calendar date (not a timestamp) is the point: it's what makes
  // "once per day" well-defined and claimable, regardless of exactly
  // what minute each instance's cron fires at.
  const runKey = new Date().toISOString().slice(0, 10);

  const won = await claimRun(JOB_NAME, runKey);
  if (!won) {
    logger.info(`[CRON] ${JOB_NAME} already claimed for ${runKey} by another instance/run — skipping.`);
    return { skipped: true };
  }

  logger.info(`[CRON] ${JOB_NAME} claimed for ${runKey} — running scans.`);

  const overdueResult    = await notificationService.runOverdueInstallmentScan();
  const licenseResult    = await notificationService.runLicenseExpiryScan();
  // Phase 4: subscription expiry warnings (7/3/1 days) + the
  // ACTIVE/TRIAL → EXPIRED claim flip. Same daily claim — no extra
  // clock, no extra lock.
  const subscriptionResult = await notificationService.runSubscriptionExpiryScan();
  // F3: PENDING_PAYMENT claims stuck in review for 72h+ are cancelled
  // automatically (same canonical cancellation path, owner-less).
  const staleResult      = await lifecycleService.runStaleRequestExpiryScan();

  logger.info(
    `[CRON] ${JOB_NAME} complete for ${runKey} — ` +
    `installments: ${overdueResult.sent}/${overdueResult.scanned}, ` +
    `licenses: ${licenseResult.sent}/${licenseResult.scanned}, ` +
    `subscriptions: ${subscriptionResult.sent}/${subscriptionResult.scanned} ` +
    `(${subscriptionResult.expired} expired), ` +
    `stale requests: ${staleResult.cancelled}/${staleResult.scanned}.`
  );

  return { skipped: false, overdueResult, licenseResult, subscriptionResult, staleResult };
};

/**
 * Registers the daily schedule. Call this ONCE at server startup
 * (see the integration note in the chat — server.js/app.js needs one
 * line added; not yet wired in because that file wasn't available for
 * review).
 */
const start = () => {
  // Matrix Audit (Phase 6): on Vercel, this in-process node-cron
  // registration is unreliable (see cron.routes.js's header comment
  // for the full reasoning) — Vercel sets process.env.VERCEL='1'
  // automatically on every deployment, so this skips registering a
  // timer that would mostly just never fire, and relies on Vercel
  // Cron Jobs hitting GET /api/cron/daily-notifications instead (see
  // vercel.json). Locally (npm run dev, no VERCEL env var) or on any
  // future persistent-server deployment, this still registers
  // node-cron normally below — both paths call the exact same
  // runDailyNotificationScans(), including the same ScheduledJobRun
  // lock, so neither path needs to "know" about the other.
  if (process.env.VERCEL) {
    logger.info(
      `[CRON] Running on Vercel — skipping in-process node-cron registration ` +
      `(unreliable there). Relying on Vercel Cron Jobs to call ` +
      `GET /api/cron/daily-notifications instead — see vercel.json.`
    );
    return;
  }

  // Runs once daily at 08:00 server time.
  //
  // distributed: true was deliberately NOT used here — verified
  // directly against node-cron v4's source (dist/_shared.cjs):
  // its default coordinator (EnvVarRunCoordinator) requires manually
  // setting NODE_CRON_RUN='true' on exactly one instance and 'false'
  // on every other instance, and THROWS if that env var isn't set at
  // all. That's a manual deploy-time designation, not automatic
  // coordination — and misconfigured, it either duplicates
  // notifications again or crashes the task outright. claimRun()
  // above needs zero per-instance configuration and degrades to
  // "exactly one winner" automatically no matter how many instances
  // exist — strictly stronger guarantee for this system.
  //
  // noOverlap: true IS used — free, local-process protection against
  // a second tick firing before a slow previous run finished (cheap
  // insurance; irrelevant to the cross-instance problem above, but
  // costs nothing). It only works correctly because the function
  // below is `async` and is therefore awaited internally by node-cron
  // — a non-async callback that fires-and-forgets would defeat
  // noOverlap's tracking entirely.
  cron.schedule(
    '0 8 * * *',
    async () => {
      try {
        await runDailyNotificationScans();
      } catch (err) {
        logger.error(`[CRON] ${JOB_NAME} failed:`, err);
      }
    },
    {
      name:      JOB_NAME,
      noOverlap: true,
    }
  );

  logger.info(`[CRON] ${JOB_NAME} registered — runs daily at 08:00 server time.`);
};

module.exports = { start, runDailyNotificationScans, claimRun };
