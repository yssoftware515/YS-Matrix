// ============================================================
// YS-MATRIX ERP - JWT Configuration
// Author: Yahya Al-Sulami 🦅
// v1.1 — Added generateImpersonationToken (Matrix Audit #9)
// ============================================================

const jwt = require('jsonwebtoken');
const crypto = require('crypto');

const JWT_CONFIG = {
  access: {
    secret: process.env.JWT_ACCESS_SECRET,
    expiresIn: process.env.JWT_ACCESS_EXPIRES || '15m',
  },
  refresh: {
    secret: process.env.JWT_REFRESH_SECRET,
    expiresIn: process.env.JWT_REFRESH_EXPIRES || '7d',
  },
  impersonation: {
    // Deliberately short and NOT configurable via env — impersonation
    // sessions must always be short-lived regardless of deployment config.
    expiresIn: '30m',
  },
};

/**
 * Generate access + refresh token pair
 */
const generateTokens = (payload) => {
  const accessToken = jwt.sign(payload, JWT_CONFIG.access.secret, {
    expiresIn: JWT_CONFIG.access.expiresIn,
  });

  const refreshToken = jwt.sign(payload, JWT_CONFIG.refresh.secret, {
    expiresIn: JWT_CONFIG.refresh.expiresIn,
    // F1 FIX (pre-existing race): without a nonce, two logins for the
    // SAME user within the SAME second mint IDENTICAL tokens (iat has
    // second precision) — the second refreshToken.create() then hit
    // the unique `token` constraint and login 500'd. A random jwtid
    // makes every minted token unique; verify ignores it entirely, so
    // no verification/rotation semantics change.
    jwtid: crypto.randomBytes(16).toString('hex'),
  });

  return { accessToken, refreshToken };
};

/**
 * generateImpersonationToken
 *
 * Matrix Audit (#9 — Impersonation): signs an ACCESS-ONLY token
 * (same secret/verify path as a normal access token — authenticate()
 * in auth.middleware.js needs no changes to accept it) with a fixed
 * 30-minute expiry. No matching refresh token is ever created or
 * stored — when this expires, the Axios 401 interceptor on the
 * frontend finds no refresh token and redirects to login instead of
 * silently renewing, so an impersonation session cannot be extended
 * indefinitely by accident.
 *
 * payload MUST be shaped like a normal login payload
 * ({ userId, showroomId, role }) plus one extra field:
 *   impersonatedBy: <SuperAdmin's real user id>
 * — carried through so auth.middleware.js can expose it on
 * req.impersonatedBy for audit/traceability on every subsequent
 * request during the session, without changing how identity itself
 * is resolved (still purely via decoded.userId → DB lookup).
 */
const generateImpersonationToken = (payload) => {
  return jwt.sign(payload, JWT_CONFIG.access.secret, {
    expiresIn: JWT_CONFIG.impersonation.expiresIn,
  });
};

/**
 * Verify access token
 */
const verifyAccessToken = (token) => {
  return jwt.verify(token, JWT_CONFIG.access.secret);
};

/**
 * Verify refresh token
 */
const verifyRefreshToken = (token) => {
  return jwt.verify(token, JWT_CONFIG.refresh.secret);
};

/**
 * Get refresh token expiry date for DB storage
 */
const getRefreshTokenExpiry = () => {
  const days = parseInt(process.env.JWT_REFRESH_EXPIRES || '7');
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + days);
  return expiry;
};

/**
 * Phase A (P2-1): one-way hash of a refresh token for DB storage.
 *
 * The raw token is only ever handed to the client; the database stores
 * the SHA-256 digest — the same convention already used by
 * PasswordResetToken (token_hash). A database leak alone can never
 * yield a usable refresh token. Lookup/revocation always hash the
 * presented token first, then query by the digest.
 */
const hashRefreshToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

module.exports = {
  JWT_CONFIG,
  generateTokens,
  generateImpersonationToken,
  verifyAccessToken,
  verifyRefreshToken,
  getRefreshTokenExpiry,
  hashRefreshToken,
};
