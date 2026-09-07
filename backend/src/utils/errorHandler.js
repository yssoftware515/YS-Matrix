// ============================================================
// YS-MATRIX ERP — Unified Error Handling (Batch 8 · Item M)
//
// Single source of truth for service-layer error mapping. Replaces
// the ten per-controller `handleServiceError` copies that used to
// drift across files (some mapped CONFLICT→'ACCOUNT_STATE_CONFLICT',
// some handled PLAN_LIMIT_REACHED, others mapped nothing at all).
// Every known `code` the services throw resolves to the SAME safe
// Arabic response the controllers produced before.
// ============================================================

'use strict';

const logger   = require('../config/logger');
const response = require('./response');
const { handlePrismaError } = require('./prismaErrorHandler');

// Fallback for unexpected errors. Kept generic and domain-agnostic —
// controllers previously returned slightly different texts here; a
// single shared message is the point of the unification.
const DEFAULT_SERVER_MESSAGE = 'حدث خطأ في معالجة الطلب.';

/**
 * handleServiceError(res, err, opts)
 *
 * Maps a service-layer error (an Error object carrying a `code`) to the
 * matching response helper:
 *   • NOT_FOUND           → 404
 *   • VALIDATION_ERROR    → 400 with err.errors (when present)
 *   • CONFLICT            → 409 (code overridable via opts.conflictCode)
 *   • FORBIDDEN           → 403
 *   • PLAN_LIMIT_REACHED  → 403 (code preserved)
 * Everything else is logged and surfaced as a safe generic 500.
 *
 * opts: { conflictCode, serverMessage }
 */
function handleServiceError(res, err, opts = {}) {
  if (err?.code === 'NOT_FOUND')        return response.notFound(res, err.message);
  if (err?.code === 'VALIDATION_ERROR') return response.validationError(res, err.errors || null, err.message);
  if (err?.code === 'CONFLICT')         return response.conflict(res, err.message, opts.conflictCode || 'CONFLICT');
  if (err?.code === 'FORBIDDEN')        return response.forbidden(res, err.message);
  if (err?.code === 'PLAN_LIMIT_REACHED') return response.forbidden(res, err.message, 'PLAN_LIMIT_REACHED');

  logger.error('Service error:', err);
  return response.serverError(res, opts.serverMessage || DEFAULT_SERVER_MESSAGE);
}

/**
 * asyncHandler(fn, opts)
 *
 * Wraps an async controller so the repetitive try/catch around every
 * handler disappears — rejections flow into handleServiceError with the
 * same opts (per-domain overrides such as conflictCode). Handlers keep
 * their exact success behavior; only the catch paths are unified.
 */
const asyncHandler = (fn, opts = {}) => async (req, res, next) => {
  try {
    await fn(req, res, next);
  } catch (err) {
    handleServiceError(res, err, opts);
  }
};

/**
 * errorMiddleware(err, req, res, next)
 *
 * Global Express error handler (was inline in src/index.js). Preserves
 * the existing branches — CORS / JSON parse failure / payload too large
 * / Prisma — and additionally maps any known service-level code that is
 * forwarded through next(err), so controllers that abandon try/catch
 * entirely still get identical responses.
 */
// eslint-disable-next-line no-unused-vars
function errorMiddleware(err, req, res, next) {
  if (err.message?.includes('CORS'))      return response.forbidden(res, 'طلب محجوب بسبب سياسة CORS.', 'CORS_BLOCKED');
  if (err.type === 'entity.parse.failed') return response.validationError(res, null, 'صيغة JSON غير صالحة.');
  if (err.type === 'entity.too.large')    return response.error(res, 'حجم الطلب أكبر من المسموح.', 413);

  if (handlePrismaError(err, res)) return;

  if (['NOT_FOUND', 'VALIDATION_ERROR', 'CONFLICT', 'FORBIDDEN', 'PLAN_LIMIT_REACHED'].includes(err?.code)) {
    return handleServiceError(res, err);
  }

  logger.error('Unhandled error:', { message: err.message, path: req.path, method: req.method });

  // F-9 FIX preserved: positive whitelist — only the exact string
  // 'development' leaks the raw message; everything else fails closed
  // to the safe generic response.
  return response.serverError(
    res,
    process.env.NODE_ENV === 'development' ? err.message : 'خطأ داخلي في الخادم.'
  );
}

module.exports = {
  handleServiceError,
  asyncHandler,
  errorMiddleware,
  DEFAULT_SERVER_MESSAGE,
};