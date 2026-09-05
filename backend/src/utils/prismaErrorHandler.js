// ============================================================
// YS-MATRIX ERP — Prisma Error Handler
// Maps Prisma error codes to safe, user-friendly Arabic messages.
// Never exposes internal schema details (table/column names).
// ============================================================

'use strict';

const logger = require('../config/logger');

/**
 * PRISMA_ERROR_MAP — every known Prisma error code mapped to a
 * safe HTTP status + Arabic message. Unknown codes fall through
 * to a generic 500 response.
 */
const PRISMA_ERROR_MAP = {
  // Unique constraint violation (e.g. duplicate email)
  P2002: {
    status: 409,
    message: 'هذا السجل موجود مسبقاً.',
  },
  // Record not found (e.g. delete/update of nonexistent row)
  P2025: {
    status: 404,
    message: 'السجل غير موجود.',
  },
  // Foreign key constraint violation (e.g. delete referenced row)
  P2003: {
    status: 409,
    message: 'لا يمكن الحذف: هذا السجل مرتبط ببيانات أخرى.',
  },
  // Value too long for column
  P2000: {
    status: 400,
    message: 'القيمة المدخلة طويلة جداً.',
  },
  // Query took too long (timeout)
  P2024: {
    status: 504,
    message: 'الاستعلام استغرق وقتاً أطول من المسموح. يرجى تقليل حجم البيانات.',
  },
  // Required relation violation
  P2014: {
    status: 400,
    message: 'الرجاء تعبئة جميع الحقول المطلوبة.',
  },
};

/**
 * isPrismaError(err)
 *
 * Returns true if the error is a known Prisma client error.
 * Prisma errors have a `code` property matching the P#### pattern
 * and a `name` property of 'PrismaClientKnownRequestError'.
 */
function isPrismaError(err) {
  return err?.name === 'PrismaClientKnownRequestError'
    || (typeof err?.code === 'string' && /^P\d{4}$/.test(err.code));
}

/**
 * handlePrismaError(err, res)
 *
 * Maps a Prisma error to a safe HTTP response. Logs the FULL error
 * (including table/column details) to Winston for debugging, but
 * NEVER sends those details to the client.
 *
 * Returns true if the error was handled (caller should return),
 * false if the error is not a Prisma error (caller should continue).
 */
function handlePrismaError(err, res) {
  if (!isPrismaError(err)) return false;

  const mapped = PRISMA_ERROR_MAP[err.code] || {
    status: 500,
    message: 'حدث خطأ غير متوقع. يرجى المحاولة لاحقاً.',
  };

  // Full error details go to Winston only — never to the client.
  logger.error('Prisma error:', {
    code:    err.code,
    message: err.message,
    meta:    err.meta,
  });

  const response = require('./response');
  response.error(res, mapped.message, mapped.status);

  return true;
}

module.exports = {
  isPrismaError,
  handlePrismaError,
  PRISMA_ERROR_MAP,
};
