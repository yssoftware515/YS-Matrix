// ============================================================
// YS-MATRIX ERP — Audit Redaction (Phase 3 — Platform Audit)
//
// PURE module — no DB access, no side effects.
//
// The audit trail concentrates cross-showroom PII by design
// (customer full-row JSON with national_id / phone, IP addresses,
// admin emails). The platform audit surface (platform_audit:read)
// is GLOBAL-scoped, so every response to a NON-SUPER_ADMIN viewer
// (delegated GLOBAL-scope administrators) is redacted server-side
// before leaving the controller. SUPER_ADMIN sees raw records —
// consistent with the visibility that role already holds everywhere.
//
// Redaction contract (approved Phase 3 slice):
//   • Keys redacted recursively anywhere in old_data / new_data:
//       national_id, phone, phone_number
//   • Emails in payloads remain visible (accountability: actor /
//     target identities mirror the joined `user` row) — only the
//     customer PII class is masked.
//   • The replacement value is the fixed string '[REDACTED]' so the
//     shape of the JSON survives intact for the frontend.
// ============================================================

'use strict';

const REDACTED_KEYS = Object.freeze(new Set(['national_id', 'phone', 'phone_number']));

const REDACTED_VALUE = '[REDACTED]';

/**
 * redactJson(value) — deep-clones a JSON payload and replaces every
 * key in REDACTED_KEYS with REDACTED_VALUE, at any depth and inside
 * arrays/objects. Non-object values pass through untouched (cloned).
 * Unknown/shallow callers can pass raw primitives safely.
 */
function redactJson(value) {
  if (Array.isArray(value)) {
    return value.map((v) => redactJson(v));
  }

  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = REDACTED_KEYS.has(k) ? REDACTED_VALUE : redactJson(v);
    }
    return out;
  }

  return value;
}

/**
 * redactAuditRow(row, redact) — maps a loaded AuditLog row (as
 * returned by Prisma, including JSON columns) to a response-safe
 * copy. When `redact` is false (SUPER_ADMIN viewer) the row is
 * returned as-is; when true, old_data / new_data pass through
 * redactJson().
 */
function redactAuditRow(row, redact) {
  if (!redact) return row;

  return {
    ...row,
    ...(row.old_data !== null && row.old_data !== undefined
      ? { old_data: redactJson(row.old_data) }
      : {}),
    ...(row.new_data !== null && row.new_data !== undefined
      ? { new_data: redactJson(row.new_data) }
      : {}),
  };
}

module.exports = { REDACTED_KEYS, REDACTED_VALUE, redactJson, redactAuditRow };