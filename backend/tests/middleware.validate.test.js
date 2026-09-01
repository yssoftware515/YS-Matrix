'use strict';
// Phase 0 baseline — input validation behavior of validate.middleware.js.
const test = require('node:test');
const assert = require('node:assert');
const { z } = require('zod');

const { validate, validateMulti, formatZodErrors } = require('../src/middleware/validate.middleware');

const mkRes = () => {
  const res = { statusCode: 0, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
};
const delegated = () => { let called = false; const next = () => { called = true; }; next.called = () => called; return next; };

const saleSchema = z.object({
  customerId: z.string().min(1),
  items: z.array(z.object({ inventoryId: z.string(), quantity: z.number().int().min(1).max(50) })).min(1).max(50),
  discount: z.number().min(0).default(0),
});

test('validate baseline: valid body passes and is coerced back to req.body', () => {
  const req = { body: { customerId: 'c1', items: [{ inventoryId: 'i1', quantity: 2 }], discount: 0 } };
  const next = delegated();
  validate(saleSchema)(req, mkRes(), next);
  assert.ok(next.called());
  assert.strictEqual(req.body.customerId, 'c1');
});

test('validate baseline: invalid body → 400 VALIDATION_ERROR with field errors', () => {
  const res = mkRes();
  const next = delegated();
  validate(saleSchema)({ body: { customerId: '', items: [] } }, res, next);
  assert.strictEqual(res.statusCode, 400);
  assert.strictEqual(res.body.code, 'VALIDATION_ERROR');
  assert.ok(res.body.errors.customerId);
  assert.ok(res.body.errors.items);
  assert.ok(!next.called());
});

test('validate baseline: quantity bounds enforced (1-50 items, int)', () => {
  const res = mkRes();
  const next = delegated();
  validate(saleSchema)({ body: { customerId: 'c1', items: [{ inventoryId: 'i1', quantity: 51 }] } }, res, next);
  assert.strictEqual(res.statusCode, 400);
  assert.ok(!next.called());

  const res2 = mkRes();
  const next2 = delegated();
  validate(saleSchema)({ body: { customerId: 'c1', items: [{ inventoryId: 'i1', quantity: 2.5 }] } }, res2, next2);
  assert.strictEqual(res2.statusCode, 400);
  assert.ok(!next2.called());
});

test('validate baseline: query source validated against req.query', () => {
  const schema = z.object({ page: z.coerce.number().int().min(1).default(1) });
  const req = { query: { page: 'abc' } };
  const res = mkRes();
  validate(schema, 'query')(req, res, delegated());
  assert.strictEqual(res.statusCode, 400);

  const req2 = { query: { page: '3' } };
  const next2 = delegated();
  validate(schema, 'query')(req2, mkRes(), next2);
  assert.ok(next2.called());
  assert.strictEqual(req2.query.page, 3);
});

test('validateMulti baseline: aggregates errors with source prefix', () => {
  const res = mkRes();
  const next = delegated();
  validateMulti({ body: saleSchema, params: z.object({ id: z.string().min(3) }) })(
    { body: { customerId: '' }, params: { id: 'x' } },
    res,
    next
  );
  assert.strictEqual(res.statusCode, 400);
  assert.ok(res.body.errors['body.customerId']);
  assert.ok(res.body.errors['params.id']);
  assert.ok(!next.called());
});

test('formatZodErrors baseline: nested paths flattened', () => {
  const err = new z.ZodError([
    { path: ['items', 0, 'unit_price'], message: 'Expected number, received string', code: 'invalid_type', expected: 'number', received: 'string' },
  ]);
  const flat = formatZodErrors(err);
  assert.ok(flat['items[0].unit_price']);
});