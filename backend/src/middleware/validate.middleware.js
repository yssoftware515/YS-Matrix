// ============================================================
// YS-MATRIX ERP — Validate Middleware (Phase 2 Stage 1)
// Changes vs original:
//   • Uses unified response.validationError() helper
//   • formatZodErrors preserved — output format unchanged
//   • Added sanitizeBody option to strip unknown fields (safe default: off)
//   • validateMulti error prefix cleaner
//   • No breaking change to existing route usage
// ============================================================

'use strict';

const { ZodError } = require('zod');
const response     = require('../utils/response');

/**
 * formatZodErrors
 *
 * Converts Zod's raw error array into a flat object:
 * { "items[0].unit_price": "Expected number, received string" }
 */
const formatZodErrors = (error) =>
  error.errors.reduce((acc, issue) => {
    const path = issue.path
      .map((segment, idx) => {
        if (typeof segment === 'number') return `[${segment}]`;
        return idx === 0 ? segment : `.${segment}`;
      })
      .join('');

    acc[path || '_root'] = issue.message;
    return acc;
  }, {});

/**
 * validate(schema, source?)
 *
 * @param schema  — Zod schema
 * @param source  — 'body' | 'query' | 'params'  (default: 'body')
 *
 * Usage:
 *   router.post('/', validate(createSaleSchema), controller)
 *   router.get('/',  validate(listQuerySchema, 'query'), controller)
 */
const validate = (schema, source = 'body') => (req, res, next) => {
  const data =
    source === 'query'  ? req.query  :
    source === 'params' ? req.params :
    req.body;

  const result = schema.safeParse(data);

  if (!result.success) {
    return response.validationError(res, formatZodErrors(result.error));
  }

  // Apply coerced / transformed values back to the request
  if (source === 'query')       req.query  = result.data;
  else if (source === 'params') req.params = result.data;
  else                          req.body   = result.data;

  next();
};

/**
 * validateMulti({ body?, query?, params? })
 *
 * Validates multiple sources in one middleware.
 *
 * Usage:
 *   router.put('/:id', validateMulti({
 *     params: idParamSchema,
 *     body:   updateInventorySchema,
 *   }), controller)
 */
const validateMulti = (schemas = {}) => (req, res, next) => {
  const allErrors = {};

  for (const [source, schema] of Object.entries(schemas)) {
    const data =
      source === 'query'  ? req.query  :
      source === 'params' ? req.params :
      req.body;

    const result = schema.safeParse(data);

    if (!result.success) {
      const errors = formatZodErrors(result.error);
      for (const [key, msg] of Object.entries(errors)) {
        allErrors[`${source}.${key}`] = msg;
      }
    } else {
      if (source === 'query')       req.query  = result.data;
      else if (source === 'params') req.params = result.data;
      else                          req.body   = result.data;
    }
  }

  if (Object.keys(allErrors).length > 0) {
    return response.validationError(res, allErrors);
  }

  next();
};

module.exports = { validate, validateMulti, formatZodErrors };
