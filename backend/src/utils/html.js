'use strict';
// ============================================================
// YS-MATRIX ERP — Shared printable-document helpers (Phase C.1)
//
// Single source of truth for the security-critical pieces shared
// by every server-rendered print document (invoice, receipt):
//   • escapeHtml     — HTML-escape free-text tenant data so it can
//                      never execute as markup
//   • fmtMoney/fmtDate — Arabic money/date formatting (numbers are
//                      only ever rendered through these, never raw)
//   • newNonce       — per-response CSP nonce
//   • documentCSP    — document-scoped CSP (B.3): script-src is
//                      'self' + the per-response nonce, never
//                      'unsafe-inline'; style-src keeps inline
//                      <style> blocks + static style attributes
//                      (template content, not user data) and https:
//                      for the Google Fonts import.
// ============================================================

const crypto = require('node:crypto');

const escapeHtml = (v) =>
  String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const fmtMoney = (n) =>
  new Intl.NumberFormat('ar').format(parseFloat(n || 0)) + ' ر.ي';

const fmtDate = (d) =>
  new Date(d).toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

const newNonce = () => crypto.randomBytes(16).toString('hex');

const documentCSP = (nonce) =>
  `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline' https:; font-src https:; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`;

module.exports = { escapeHtml, fmtMoney, fmtDate, newNonce, documentCSP };