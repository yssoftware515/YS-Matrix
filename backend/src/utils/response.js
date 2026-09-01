// ============================================================
// YS-MATRIX ERP — Response Utility (Phase 2 Stage 1)
// Unified, consistent API response format across the entire app.
// Every controller uses ONLY these helpers — never res.json() directly.
// ============================================================

'use strict';

/**
 * Standard success envelope:
 * {
 *   success: true,
 *   message: "...",
 *   data: {...},
 *   timestamp: "..."
 * }
 *
 * Standard error envelope:
 * {
 *   success: false,
 *   message: "...",
 *   code: "ERROR_CODE",        ← machine-readable, used by frontend
 *   errors: {...},             ← validation detail (optional)
 *   timestamp: "..."
 * }
 */

const ts = () => new Date().toISOString();

// ── 2xx ──────────────────────────────────────────────────────────────────────

/** 200 OK */
const success = (res, data = null, message = 'Success') =>
  res.status(200).json({ success: true, message, data, timestamp: ts() });

/** 201 Created */
const created = (res, data = null, message = 'Created successfully') =>
  res.status(201).json({ success: true, message, data, timestamp: ts() });

/**
 * 200 Paginated list
 * pagination shape: { page, pages, total, limit, hasNext, hasPrev, ... }
 */
const paginated = (res, data = [], pagination = {}, message = 'OK') =>
  res.status(200).json({ success: true, message, data, pagination, timestamp: ts() });

// ── 4xx ──────────────────────────────────────────────────────────────────────

/**
 * 400 Bad Request — generic client/server error.
 *
 * Matrix Audit (Phase 3): this used to be TWO functions — `error`
 * (accepted an explicit `code`) and `_error` (auto-generated the code,
 * ignoring any explicit one) — with `_error` exported under the name
 * `error`, silently replacing the original. Any call site that tried
 * `response.error(res, msg, 400, 'SPECIFIC_CODE')` had that 4th
 * argument silently dropped.
 *
 * Verified safe to merge by searching EVERY `response.error(` call
 * site across the entire backend (21 calls, 8 files) before making
 * this change — not one of them currently passes a 4th argument, so
 * merging is a strict superset: every existing caller gets the exact
 * same auto-generated code as before, and the 4th argument finally
 * works for any future caller that needs a specific code.
 */
const error = (res, message = 'Bad request', statusCode = 400, code) =>
  res.status(statusCode).json({
    success:   false,
    message,
    code:      code || (statusCode >= 500 ? 'SERVER_ERROR' : 'CLIENT_ERROR'),
    timestamp: ts(),
  });

/** 400 Validation Error — field-level errors */
const validationError = (res, errors = null, message = 'Validation failed') =>
  res.status(400).json({
    success:   false,
    message,
    code:      'VALIDATION_ERROR',
    errors:    errors || {},
    timestamp: ts(),
  });

/** 401 Unauthorized */
const unauthorized = (res, message = 'Unauthorized', code = 'UNAUTHORIZED') =>
  res.status(401).json({ success: false, message, code, timestamp: ts() });

/** 403 Forbidden */
const forbidden = (res, message = 'Forbidden', code = 'FORBIDDEN') =>
  res.status(403).json({ success: false, message, code, timestamp: ts() });

/** 404 Not Found */
const notFound = (res, message = 'Resource not found', code = 'NOT_FOUND') =>
  res.status(404).json({ success: false, message, code, timestamp: ts() });

/** 409 Conflict */
const conflict = (res, message = 'Resource already exists', code = 'CONFLICT') =>
  res.status(409).json({ success: false, message, code, timestamp: ts() });

/** 429 Too Many Requests */
const tooManyRequests = (res, message = 'Too many requests', code = 'RATE_LIMITED') =>
  res.status(429).json({ success: false, message, code, timestamp: ts() });

// ── 5xx ──────────────────────────────────────────────────────────────────────

/** 500 Internal Server Error */
const serverError = (res, message = 'Internal server error', code = 'SERVER_ERROR') =>
  res.status(500).json({ success: false, message, code, timestamp: ts() });

// ── License / Subscription specific ─────────────────────────────────────────

/**
 * 403 License Expired
 * Returned by license middleware — carries extra metadata for the frontend.
 */
const licenseExpired = (res, expiry, daysExpired) =>
  res.status(403).json({
    success:       false,
    message:       'انتهت صلاحية الاشتراك. يرجى التواصل مع المسؤول.',
    code:          'LICENSE_EXPIRED',
    expired_since: expiry instanceof Date ? expiry.toISOString() : expiry,
    days_expired:  daysExpired,
    timestamp:     ts(),
  });

/**
 * 403 Showroom Inactive
 */
const showroomInactive = (res) =>
  res.status(403).json({
    success:   false,
    message:   'تم تعطيل حساب المعرض. يرجى التواصل مع المسؤول.',
    code:      'SHOWROOM_INACTIVE',
    timestamp: ts(),
  });

/**
 * 403 Onboarding Required
 */
const onboardingRequired = (res) =>
  res.status(403).json({
    success:    false,
    message:    'يرجى إكمال إعداد بيانات المعرض أولاً.',
    message_ar: 'يرجى إكمال إعداد بيانات المعرض أولاً قبل الوصول لهذه الخاصية.',
    code:       'ONBOARDING_REQUIRED',
    redirect:   '/dashboard/onboarding',
    timestamp:  ts(),
  });

/**
 * 403 Subscription Required (Phase 4 — account lifecycle)
 * Sent by license middleware when an account has NO subscription
 * (self-registered, never purchased). Distinct from LICENSE_EXPIRED
 * (license ran out) — this one means "subscribe first".
 */
const subscriptionRequired = (res) =>
  res.status(403).json({
    success:  false,
    message:  'حسابك يحتاج إلى اشتراك فعّال. يرجى اختيار باقة للبدء.',
    code:     'SUBSCRIPTION_REQUIRED',
    redirect: '/subscribe',
    timestamp: ts(),
  });

module.exports = {
  success,
  created,
  paginated,
  // Primary error helpers
  error,
  validationError,
  unauthorized,
  forbidden,
  notFound,
  conflict,
  tooManyRequests,
  serverError,
  // Domain-specific
  licenseExpired,
  showroomInactive,
  onboardingRequired,
  subscriptionRequired,
};
