// ============================================================
// YS-MATRIX ERP — Cron Trigger Routes (Vercel Cron Jobs)
// ============================================================
//
// Matrix Audit (Phase 6 — Vercel Architecture Mismatch, discovered
// while reviewing rhel-openssl binaryTargets):
//
// node-cron's in-process cron.schedule() (jobs/scheduledNotifications.
// job.js) cannot reliably fire on Vercel. Vercel runs this app as a
// Serverless Function (confirmed directly from vercel.json's
// builds/routes — every request routes to src/index.js as one
// @vercel/node function) — a function instance only exists while
// handling a request, and there is no guarantee ANY instance is alive
// at 08:00 specifically. The in-process timer registered by
// cron.schedule() simply never fires if nothing happens to be warm at
// that moment — silently, no error anywhere.
//
// This route is the correct mechanism for Vercel specifically:
// Vercel's OWN infrastructure (configured in vercel.json's `crons`
// array) sends an HTTP request to this path on schedule — Vercel
// guarantees that request fires, regardless of warm/cold state. The
// actual job logic (runDailyNotificationScans, including the
// ScheduledJobRun Postgres lock) is COMPLETELY UNCHANGED and fully
// reused — only the trigger mechanism differs. The node-cron path in
// scheduledNotifications.job.js still exists too, for local dev /
// any future persistent-server deployment — see the VERCEL check in
// its start() function.
//
// SECURITY: this MUST be public (no authenticate/tenantGuard —
// Vercel's cron trigger carries no user session/JWT), but must NOT be
// triggerable by anyone who simply guesses the URL. Protected by a
// shared secret (CRON_SECRET) sent as a Bearer token instead.
//
// ⚠️ Verify against Vercel's CURRENT official cron docs
// (https://vercel.com/docs/cron-jobs) before relying on this in
// production — specifically how Vercel sends CRON_SECRET as an auth
// header. This matches Vercel's documented behavior as understood at
// the time this was written; Vercel's own docs are the source of
// truth if anything has changed since.
// ============================================================

'use strict';

const crypto  = require('crypto');
const express = require('express');
const router  = express.Router();
const logger  = require('../config/logger');
const scheduledNotificationsJob = require('../jobs/scheduledNotifications.job');

// Phase A (P2-4): constant-time secret comparison — the token is a
// high-entropy shared secret; a timing side channel is unnecessary
// exposure. Lengths are checked first (timingSafeEqual throws on
// length mismatch).
const secretMatches = (presented, expected) => {
  const a = Buffer.from(String(presented ?? ''));
  const b = Buffer.from(String(expected ?? ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

router.get('/daily-notifications', async (req, res) => {
  if (!process.env.CRON_SECRET) {
    // Fail LOUDLY instead of silently running unprotected — an
    // unguarded public endpoint that triggers DB writes is worse than
    // a cron job that visibly fails until configured correctly.
    logger.error('[CRON-HTTP] CRON_SECRET is not configured — refusing to run unprotected.');
    return res.status(500).json({ success: false, message: 'CRON_SECRET not configured.' });
  }

  const authHeader = req.headers.authorization;
  const presented = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (!secretMatches(presented, process.env.CRON_SECRET)) {
    logger.warn('[CRON-HTTP] Rejected unauthorized trigger attempt for daily-notifications.');
    return res.status(401).json({ success: false, message: 'Unauthorized' });
  }

  try {
    const result = await scheduledNotificationsJob.runDailyNotificationScans();
    return res.status(200).json({ success: true, result });
  } catch (err) {
    // Phase A (P2-4): never echo err.message — an internal exception
    // (DB path, connection string fragment, file layout) must stay
    // server-side. The caller only needs to know the run failed; the
    // full detail goes to the operator's logs.
    logger.error('[CRON-HTTP] daily-notifications run failed:', err);
    return res.status(500).json({ success: false, message: 'Scheduled notification scan failed. Check server logs.' });
  }
});

module.exports = router;
