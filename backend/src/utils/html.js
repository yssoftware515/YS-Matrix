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

const errorPage = (status, title) =>
  `<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)}</title>
  <style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:system-ui,-apple-system,sans-serif;background:#f8f9fa;color:#333}
    .err{text-align:center;padding:2rem}
    .err h1{font-size:4rem;margin:0;color:#dc3545}
    .err p{font-size:1.1rem;color:#666;margin-top:.5rem}
  </style>
</head>
<body>
  <div class="err">
    <h1>${status}</h1>
    <p>${escapeHtml(title)}</p>
  </div>
</body>
</html>`;

module.exports = { escapeHtml, fmtMoney, fmtDate, newNonce, documentCSP, errorPage };