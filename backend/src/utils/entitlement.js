// ============================================================
// YS-MATRIX ERP — Entitlement Capability Catalog (Phase C.7)
//
// ARCHITECTURE BOUNDARY ONLY — no runtime behavior is gated here
// yet. This module exists so future add-on/module entitlements are
// data-driven instead of hard-coded conditionals like
// `if plan === "PRO" then CRM = true`.
//
// RBAC (WHO can act) and ENTITLEMENTS (WHICH product capabilities
// the tenant has) are separate concerns: RBAC stays in the
// authorization layer; this catalog describes capabilities that a
// plan/tenant may carry (now or later) and how to read them off a
// plan row.
//
// Plans carry their entitlements in `features.capabilities` (array
// of capability ids, jsonb). Today every plan ships exactly
// ['core']; CRM / AI Assistant / Digital Showroom / Messaging /
// Advanced Analytics are REGISTERED here so future phases enable
// them per plan or as independently purchased add-ons WITHOUT any
// schema or pricing redesign.
// ============================================================

'use strict';

const CAPABILITIES = Object.freeze([
  {
    id:          'core',
    label_en:    'Core dealership management',
    label_ar:    'إدارة المعرض الأساسية',
    kind:        'core',
  },
  {
    id:          'digital_showroom',
    label_en:    'Digital Showroom',
    label_ar:    'المعرض الرقمي',
    kind:        'addon',
  },
  {
    id:          'crm',
    label_en:    'CRM (leads, follow-ups, pipeline)',
    label_ar:    'إدارة العملاء والفرص',
    kind:        'addon',
  },
  {
    id:          'ai_assistant',
    label_en:    'AI Assistant',
    label_ar:    'المساعد الذكي',
    kind:        'addon',
  },
  {
    id:          'messaging',
    label_en:    'Customer messaging (WhatsApp / notifications)',
    label_ar:    'رسائل العملاء',
    kind:        'addon',
  },
  {
    id:          'advanced_analytics',
    label_en:    'Advanced analytics',
    label_ar:    'التحليلات المتقدمة',
    kind:        'addon',
  },
]);

const CAPABILITY_BY_ID = Object.freeze(
  CAPABILITIES.reduce((acc, c) => { acc[c.id] = c; return acc; }, {})
);

// Entitlements of a plan row: `features.capabilities` (jsonb array).
// Absent/legacy features objects default to ['core'] so every plan
// always has the core capability without schema backfill.
const getCapabilities = (plan) => {
  if (!plan || !plan.features) return ['core'];
  const caps = Array.isArray(plan.features.capabilities)
    ? plan.features.capabilities
    : null;
  if (caps && caps.length > 0) return caps.filter((c) => typeof c === 'string');
  return ['core'];
};

const hasCapability = (plan, capabilityId) => {
  if (!CAPABILITY_BY_ID[capabilityId]) return false;
  return getCapabilities(plan).includes(capabilityId);
};

module.exports = {
  CAPABILITIES,
  CAPABILITY_BY_ID,
  getCapabilities,
  hasCapability,
};