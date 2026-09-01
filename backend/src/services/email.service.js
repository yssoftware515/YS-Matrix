// ============================================================
// YS-MATRIX ERP — Email Service (Matrix Audit — Phase 1)
// Provider: Resend (https://resend.com)
// ============================================================
//
// VERIFIED DIRECTLY AGAINST THE PACKAGE SOURCE (not just docs) before
// writing this: resend's emails.send() does NOT throw for API-level
// failures (bad API key, unverified sending domain, rate limit,
// invalid recipient, etc.) — it resolves normally with
// `{ data: null, error: {...} }`. It only throws for network-level
// failures (DNS, connectivity). Both cases are handled below — this
// function throws either way, so every caller's existing try/catch
// handles both identically with one code path.
// ============================================================

'use strict';

const { Resend } = require('resend');
const logger = require('../config/logger');

// Until a domain is verified on the Resend dashboard, only
// onboarding@resend.dev can be used as the sender — real recipient
// domains will reject anything else. Switch RESEND_FROM_EMAIL in
// .env once a real domain is verified.
const FROM_EMAIL = process.env.RESEND_FROM_EMAIL || 'YS-MATRIX <onboarding@resend.dev>';

// ─────────────────────────────────────────────────────────────
// Lazy client construction — CRITICAL, do not change without reading
// this. `new Resend(key)` throws SYNCHRONOUSLY and IMMEDIATELY if
// `key` is falsy — not when an email is actually sent, but the
// instant the client is constructed. This module is required at
// server BOOT time (superadmin.controller.js requires it at the top
// of the file, which is required by auth.routes.js, required by
// index.js). Constructing the client at module load time means a
// missing/blank RESEND_API_KEY crashes the ENTIRE server before it
// can even start listening — confirmed the hard way.
//
// Building it lazily, on first actual send attempt, means a missing
// key only fails the ONE request that needed to send an email — it's
// caught by forgotPasswordRequest's existing try/catch around the
// email call, logged, and the generic anti-enumeration response still
// goes out, exactly like any other email-send failure. The rest of
// the server keeps running normally either way.
// ─────────────────────────────────────────────────────────────
let resendClient = null;

const getResendClient = () => {
  if (resendClient) return resendClient;

  if (!process.env.RESEND_API_KEY) {
    throw Object.assign(
      new Error('RESEND_API_KEY is not configured — add it to .env (see https://resend.com/api-keys).'),
      { code: 'EMAIL_NOT_CONFIGURED' }
    );
  }

  resendClient = new Resend(process.env.RESEND_API_KEY);
  return resendClient;
};

// ─────────────────────────────────────────────────────────────
// Template — kept deliberately simple (inline styles only, no
// <style> block, no external fonts/images): most email clients strip
// <style> blocks and many block remote font/image loads outright, so
// "matching the matrix-cyan cyberpunk theme exactly" would mostly
// just fail silently in real inboxes. This stays readable everywhere
// and still uses the brand's cyan accent + dark-on-light card via
// inline styles only, which DO survive across clients.
// ─────────────────────────────────────────────────────────────
const buildResetEmailHtml = ({ name, resetUrl, expiresInMinutes }) => `
<!DOCTYPE html>
<html dir="rtl" lang="ar">
  <body style="margin:0;padding:0;background-color:#f4f4f7;font-family:Tahoma,Arial,sans-serif;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" style="max-width:480px;background-color:#0a0e14;border-radius:12px;overflow:hidden;border:1px solid #1a2230;">
            <tr>
              <td style="padding:28px 28px 8px 28px;text-align:center;">
                <span style="color:#00d4ff;font-size:20px;font-weight:bold;letter-spacing:2px;">YS-MATRIX</span>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px 28px 28px;color:#e2e8f0;font-size:15px;line-height:1.8;text-align:right;">
                <p>مرحباً ${name}،</p>
                <p>وصلنا طلب لإعادة تعيين كلمة مرور حسابك في YS-MATRIX. اضغط الزر أدناه لاختيار كلمة مرور جديدة:</p>
                <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:24px 0;">
                  <tr>
                    <td align="center">
                      <a href="${resetUrl}" style="display:inline-block;background-color:#00d4ff;color:#020408;font-weight:bold;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;">
                        إعادة تعيين كلمة المرور
                      </a>
                    </td>
                  </tr>
                </table>
                <p style="color:#94a3b8;font-size:13px;">هذا الرابط صالح لمدة ${expiresInMinutes} دقيقة فقط، ولمرة استخدام واحدة.</p>
                <p style="color:#94a3b8;font-size:13px;">إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة بأمان — حسابك لن يتأثر.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:16px 28px;border-top:1px solid #1a2230;text-align:center;">
                <span style="color:#475569;font-size:11px;">YS-MATRIX ERP &middot; YS Systems &amp; Software</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`;

/**
 * Sends the password reset email. Throws on ANY failure (network-level
 * exception OR Resend's { error } response shape) — callers should
 * already wrap this in try/catch (forgotPasswordRequest does, and
 * deliberately still returns its generic anti-enumeration response
 * either way).
 */
// ─────────────────────────────────────────────────────────────
// Transport selection (Phase 2 — F-01).
//
// The loader (src/config/env.js) strips RESEND_API_KEY from every
// test process, so a real Resend client can never exist there. The
// console transport gives tests a deterministic, network-free way to
// exercise BOTH send outcomes:
//   - EMAIL_TRANSPORT=console (set in .env.test): the send "succeeds"
//     (logged, nothing sent, Resend never constructed).
//   - EMAIL_SIMULATE_FAILURE=true: the console transport THROWS
//     EMAIL_SEND_FAILED — read per-send so a test can toggle it
//     mid-run and assert the failure/audit path deterministically.
// Production / dev behavior is untouched: default transport = Resend,
// lazy client, throws EMAIL_NOT_CONFIGURED at send time if the key is
// missing (a missing key only fails the one email, never the server).
// ─────────────────────────────────────────────────────────────
const buildTransport = () => {
  if (process.env.EMAIL_TRANSPORT === 'console') return 'console';
  return 'resend';
};

const sendPasswordResetEmail = async ({ to, name, resetUrl, expiresInMinutes }) => {
  if (buildTransport() === 'console') {
    if (process.env.EMAIL_SIMULATE_FAILURE === 'true') {
      logger.error('[Email] Simulated send failure (EMAIL_SIMULATE_FAILURE=true).');
      throw Object.assign(new Error('Simulated email failure (EMAIL_SIMULATE_FAILURE=true).'), {
        code: 'EMAIL_SEND_FAILED',
      });
    }
    logger.info(
      `[Email][console-transport] Simulated password-reset email — ` +
      `to=${to} name=${name} resetUrlLen=${resetUrl.length} expiresInMinutes=${expiresInMinutes}`
    );
    return { id: 'console-transport-simulated', to };
  }

  const { data, error } = await getResendClient().emails.send({
    from:    FROM_EMAIL,
    to,
    subject: 'إعادة تعيين كلمة المرور — YS-MATRIX',
    html:    buildResetEmailHtml({ name, resetUrl, expiresInMinutes }),
  });

  if (error) {
    logger.error('[Email] Resend API error sending password reset email:', error);
    throw Object.assign(new Error(error.message || 'Email send failed'), {
      code: 'EMAIL_SEND_FAILED',
      resendError: error,
    });
  }

  logger.info(`[Email] Password reset email sent — id=${data.id} to=${to}`);
  return data;
};

module.exports = { sendPasswordResetEmail };