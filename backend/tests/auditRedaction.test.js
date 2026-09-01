'use strict';
// Phase 3 (Platform Audit & Observability) — pure unit tests:
//   • the platform_audit:read catalog contract (runtime-only, GLOBAL)
//   • the audit redaction helper (PII masking for delegated viewers)
//   • the audit query validation schema bounds
// NO DB, NO network, NO .env — same discipline as permissionCatalog.test.js.
const test = require('node:test');
const assert = require('node:assert');

const {
  PERMISSIONS,
  PROFILE_DEFINITIONS,
  isCatalogPermission,
  isPlatformPermission,
  SCOPES,
} = require('../src/services/permissionCatalog');

const { redactJson, redactAuditRow, REDACTED_KEYS, REDACTED_VALUE } = require('../src/utils/auditRedaction');

const { auditQuerySchema, auditIdParamsSchema } = require('../src/validations/audit.validation');

// ── Catalog contract ──────────────────────────────────────────
test('catalog: platform_audit:read exists with the strict key format', () => {
  const entry = PERMISSIONS.find((p) => p.key === 'platform_audit:read');
  assert.ok(entry, 'platform_audit:read must be in the catalog');
  assert.strictEqual(entry.resource, 'platform_audit');
  assert.strictEqual(entry.action, 'read');
  assert.strictEqual(entry.key, `${entry.resource}:${entry.action}`);
  assert.ok(isCatalogPermission('platform_audit:read'));
});

test('catalog: platform_audit:read is a runtime-only platform permission, never in parity profiles', () => {
  assert.ok(isPlatformPermission('platform_audit:read'), 'resource prefix must be platform_');

  const staffKeys = new Set(PROFILE_DEFINITIONS.STAFF.permissions.map((r) => r.permission));
  const ownerKeys = new Set(PROFILE_DEFINITIONS.OWNER.permissions.map((r) => r.permission));
  assert.ok(!staffKeys.has('platform_audit:read'), 'STAFF must never hold it');
  assert.ok(!ownerKeys.has('platform_audit:read'), 'OWNER must never hold it');
  assert.ok(!Object.values(PROFILE_DEFINITIONS).some((d) => d.scope === SCOPES.GLOBAL), 'no profile is GLOBAL-scoped');
});

// ── Redaction helper ──────────────────────────────────────────
test('redaction: REDACTED_KEYS covers the PII class (national_id, phone, phone_number)', () => {
  assert.ok(REDACTED_KEYS.has('national_id'));
  assert.ok(REDACTED_KEYS.has('phone'));
  assert.ok(REDACTED_KEYS.has('phone_number'));
  assert.ok(!REDACTED_KEYS.has('email'), 'emails stay visible for accountability');
});

test('redaction: sensitive keys replaced at any depth, inside arrays and objects', () => {
  const payload = {
    name: 'Customer A',
    phone: '+10000000001',
    national_id: 'NID-1',
    meta: { contact: { phone_number: '+2', cell: '+3' }, tags: ['a', 'b'] },
    address: { line1: 'x', phone: '123' },
    history: [{ phone: '1' }, { email: 'keep@me.com' }],
  };

  const out = redactJson(payload);

  assert.strictEqual(out.phone, REDACTED_VALUE);
  assert.strictEqual(out.national_id, REDACTED_VALUE);
  assert.strictEqual(out.meta.contact.phone_number, REDACTED_VALUE);
  assert.strictEqual(out.address.phone, REDACTED_VALUE);
  assert.deepStrictEqual(out.history[0], { phone: REDACTED_VALUE }, 'array items recursed');
  assert.strictEqual(out.history[1].email, 'keep@me.com', 'non-sensitive keys pass through');
  assert.strictEqual(out.name, 'Customer A');
  assert.strictEqual(out.meta.contact.cell, '+3');
  assert.deepStrictEqual(out.meta.tags, ['a', 'b']);
});

test('redaction: original payload is never mutated (deep copy semantics)', () => {
  const payload = { phone: '+1', nested: { national_id: 'X' } };
  const out = redactJson(payload);
  out.phone = 'changed';
  out.nested.national_id = 'changed';
  assert.strictEqual(payload.phone, '+1');
  assert.strictEqual(payload.nested.national_id, 'X');
});

test('redaction: null/undefined/primitives pass through safely', () => {
  assert.strictEqual(redactJson(null), null);
  assert.strictEqual(redactJson(undefined), undefined);
  assert.strictEqual(redactJson('phone'), 'phone');
  assert.strictEqual(redactJson(42), 42);
});

test('redaction: redactAuditRow redacts old_data/new_data only; redact=false returns the raw row', () => {
  const row = {
    id: 'a1',
    action: 'CREATE',
    old_data: null,
    new_data: { name: 'C', phone: '+1', national_id: 'N' },
    extra: { untouched: true },
  };

  const redacted = redactAuditRow(row, true);
  assert.strictEqual(redacted.new_data.phone, REDACTED_VALUE);
  assert.strictEqual(redacted.new_data.national_id, REDACTED_VALUE);
  assert.strictEqual(redacted.new_data.name, 'C');
  assert.strictEqual(redacted.old_data, null, 'null JSON stays null (not a redaction target)');
  assert.deepStrictEqual(redacted.extra, { untouched: true }, 'non-JSON columns pass through');

  const raw = redactAuditRow(row, false);
  assert.strictEqual(raw.new_data.phone, '+1', 'SUPER_ADMIN keeps raw payloads');
  assert.strictEqual(raw, row, 'no copy when redact=false');
});

// ── Query schema bounds ───────────────────────────────────────
test('validation: auditQuerySchema accepts a full filter set with parsed pagination', () => {
  const r = auditQuerySchema.safeParse({
    page: 3,
    limit: 50,
    entity: 'customer',
    action: 'CREATE',
    user_id: 'u-1',
    showroom_id: 'sh-a',
    entity_id: 'c-1',
    date_from: '2026-01-01T00:00:00.000Z',
    date_to: '2026-08-10',
  });
  assert.ok(r.success, JSON.stringify(r.error?.issues));
  assert.strictEqual(r.data.page, 3);
  assert.strictEqual(r.data.limit, 50);
});

test('validation: auditQuerySchema defaults page/limit and rejects oversized/broken input', () => {
  const ok = auditQuerySchema.safeParse({});
  assert.ok(ok.success);
  assert.strictEqual(ok.data.page, 1);
  assert.strictEqual(ok.data.limit, 20);

  assert.ok(!auditQuerySchema.safeParse({ limit: 101 }).success, 'limit > 100 must be rejected');
  assert.ok(!auditQuerySchema.safeParse({ limit: 0 }).success, 'limit < 1 must be rejected');
  assert.ok(!auditQuerySchema.safeParse({ page: -1 }).success, 'negative page must be rejected');
  assert.ok(!auditQuerySchema.safeParse({ date_from: 'garbage' }).success, 'unparseable date must be rejected');
  assert.ok(!auditQuerySchema.safeParse({ date_to: 'not-a-date' }).success, 'unparseable date_to must be rejected');
  assert.ok(auditQuerySchema.safeParse({ page: '2', limit: '25' }).success, 'string numerics coerce');
});

test('validation: auditIdParamsSchema requires a non-empty id', () => {
  assert.ok(auditIdParamsSchema.safeParse({ id: 'abc' }).success);
  assert.ok(!auditIdParamsSchema.safeParse({ id: '' }).success);
  assert.ok(!auditIdParamsSchema.safeParse({}).success);
});