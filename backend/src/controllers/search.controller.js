// ============================================================
// YS-MATRIX ERP — Search Controller (Phase 2 Stage 3)
// ============================================================

'use strict';

const searchService = require('../services/search.service');
const response      = require('../utils/response');
const logger        = require('../config/logger');

const search = async (req, res) => {
  try {
    const results = await searchService.globalSearch({
      showroomId: req.showroomId,
      query:      req.query.q,
    });
    return response.success(res, results);
  } catch (err) {
    if (err.code === 'VALIDATION_ERROR') {
      return response.validationError(res, null, err.message);
    }
    logger.error('Search error:', err);
    return response.serverError(res, 'فشل تنفيذ البحث.');
  }
};

module.exports = { search };
