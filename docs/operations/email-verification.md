# Email Verification Procedure (Resend)

Transactional email (password reset, subscription notifications) is sent
through **Resend** (`backend/src/services/email.service.js`). Until a
domain is verified, the sender falls back to `onboarding@resend.dev`
which **rejects real recipient domains** — the reset flow will silently
produce `EMAIL_SEND_FAILED` audit rows (see below).

## 1. Verify the sender domain

1. Resend Dashboard → **Domains** → add the sending domain (e.g.
   `ys-matrix.com`).
2. Add the DNS records Resend shows (SPF + DKIM + optional MX/CNAME) to
   the domain's DNS provider.
3. Wait for DNS propagation, then click **Verify**.
4. Dashboard shows the domain as **Verified** with a non-"resend.dev"
   default sender.

## 2. Configure the app

```
# backend/.env (production)
RESEND_API_KEY=re_...
RESEND_FROM_EMAIL="YS-MATRIX <no-reply@ys-matrix.com>"
```

`RESEND_FROM_EMAIL` must match the verified domain. The email client is
lazy-constructed (see email.service.js header): a missing `RESEND_API_KEY`
does NOT crash the server — it fails only the single request that needs
to send, which is logged and surfaced as `EMAIL_SEND_FAILED` in the
SuperAdmin audit panel.

### Test environments only — console transport

`backend/.env.test` sets `EMAIL_TRANSPORT=console`, so test suites never
touch the Resend network: sends are logged as
`[Email][console-transport]` and resolve as simulated successes.
`EMAIL_SIMULATE_FAILURE=true` makes the console transport throw
`EMAIL_SEND_FAILED` (used by the forgot-password integration tests to
prove the audit records the honest failure status). These two variables
are per-send, so tests can toggle them mid-run. Production must keep the
default (`EMAIL_TRANSPORT=resend`, or unset) and must never carry
`EMAIL_SIMULATE_FAILURE=true`.

## 3. End-to-end test (must pass before launch)

1. Trigger a real password reset from the login page.
2. Pass criteria:
   - The email arrives within ~30s, from the verified sender, and the
     reset link works (`/auth/reset-password?token=...`).
   - The SuperAdmin audit panel (`PASSWORD_RESET_REQUESTED`) shows
     `status: EMAIL_SENT` for that request.
   - No `EMAIL_SEND_FAILED` rows appear for the same email.
3. Negative test (sender NOT yet verified — pre-domain state):
   - Reset for any registered email → generic response, and the panel
     shows `status: EMAIL_SEND_FAILED`.
   - This is the expected honest signal: the customer was told "check
     your inbox" but no email left the server. Fix the domain, then
     re-request.

## 4. Check the panel regularly during launch

The `PASSWORD_RESET_REQUESTED` audit rows are the health signal for the
mail pipeline — `EMAIL_SEND_FAILED` rows mean users are silently not
getting links. There is no separate monitoring system; the audit panel is
the designed surface (see N-4 in the Phase C.4 remediation).

## Non-negotiable

- Never commit `RESEND_API_KEY` (see `docs/archive/architecture-review.md`
  for the past .env-in-repo incident).
- Never remove the anti-enumeration generic response to keep the mail
  flow from becoming an account oracle.