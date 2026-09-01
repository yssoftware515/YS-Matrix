// ============================================================
// YS-MATRIX ERP — Payment Proof Validation (Phase 4)
//
// Server-side authority for manual-payment screenshot uploads:
//   • mime allowlist (png/jpeg/webp)
//   • magic-byte sniffing (a file renamed to .png is still rejected)
//   • raw byte cap (before base64 decoding)
//   • executed never — proof is stored base64 and served only via
//     access-locked admin/owner endpoints with a safe image content
//     type (never text/html, so it can never execute as markup).
//
// PURE module — no IO. Unit-tested directly.
// ============================================================

'use strict';

const SECURITY = require('../config/security');

const MAGIC = SECURITY.payment.proof.magicSniff;
const ALLOWED_MIMES = new Set(SECURITY.payment.proof.allowedMimes);
const MAX_BYTES = SECURITY.payment.proof.maxBytes;

/**
 * Validate a base64 proof payload against the configured policy.
 *
 * @param {string} proofData - base64 (plain, or "data:<mime>;base64,....")
 * @param {string} mime      - declared mime (must match magic bytes)
 * @returns {{ ok: true, mime: string, bytes: number, base64: string } |
 *           { ok: false, reason: string, code: string }}
 */
function validatePaymentProof(proofData, mime) {
  if (typeof proofData !== 'string' || proofData.length === 0) {
    return { ok: false, reason: 'إثبات الدفع مطلوب.', code: 'PROOF_MISSING' };
  }

  if (!mime || !ALLOWED_MIMES.has(mime)) {
    return { ok: false, reason: 'نوع الملف غير مدعوم (يُسمح بـ PNG / JPEG / WebP فقط).', code: 'PROOF_MIME_REJECTED' };
  }

  // Strip a data-URL prefix if the client sent one
  const comma = proofData.indexOf(',');
  const base64 = comma > 0 && proofData.slice(0, comma).includes('base64')
    ? proofData.slice(comma + 1)
    : proofData;

  // Reject non-base64 alphabet early (cheap pre-check before decode)
  if (!/^[A-Za-z0-9+/=\r\n\s]+$/.test(base64)) {
    return { ok: false, reason: 'بيانات الإثبات تالفة.', code: 'PROOF_INVALID_ENCODING' };
  }

  let raw;
  try {
    raw = Buffer.from(base64, 'base64');
  } catch {
    return { ok: false, reason: 'بيانات الإثبات تالفة.', code: 'PROOF_INVALID_ENCODING' };
  }

  if (raw.length === 0) {
    return { ok: false, reason: 'إثبات الدفع فارغ.', code: 'PROOF_EMPTY' };
  }
  if (raw.length > MAX_BYTES) {
    return { ok: false, reason: `حجم الملف يتجاوز الحد المسموح (${Math.floor(MAX_BYTES / 1024)}KB).`, code: 'PROOF_TOO_LARGE' };
  }

  // Magic-byte sniffing — never trust declared mime or extension
  const sig = MAGIC[mime];
  if (!sig || sig.some((byte, i) => raw[i] !== byte)) {
    return { ok: false, reason: 'محتويات الملف لا تطابق نوعه المعلن.', code: 'PROOF_MAGIC_MISMATCH' };
  }

  // WebP is RIFF....WEBP — check the container signature at bytes 8-11
  if (mime === 'image/webp') {
    const tag = raw.slice(8, 12).toString('ascii');
    if (tag !== 'WEBP') {
      return { ok: false, reason: 'محتويات الملف لا تطابق نوعه المعلن.', code: 'PROOF_MAGIC_MISMATCH' };
    }
  }

  return { ok: true, mime, bytes: raw.length, base64 };
}

module.exports = { validatePaymentProof, MAX_BYTES, ALLOWED_MIMES }; 