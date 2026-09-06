import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OWNER_EMAIL = process.env.E2E_EMAIL || 'owner@demo.com';
const OWNER_PASSWORD = process.env.E2E_PASSWORD || 'Demo@Owner2024!';
// SUPER_ADMIN credentials — only available when test fixtures are seeded
const SA_EMAIL = process.env.E2E_SA_EMAIL || 'sa@test.local';
const SA_PASSWORD = process.env.E2E_SA_PASSWORD || 'Phase0#Test2026!';

test.describe('SUPER_ADMIN login with MFA', () => {
  test('SUPER_ADMIN login returns mfa_required — API response verified', async ({ request }) => {
    // This test uses the API directly since the frontend MFA screens
    // are not yet implemented. It verifies the backend MFA flow works.
    test.setTimeout(30_000);

    // Attempt SA login — if user doesn't exist (demo seed), skip gracefully
    const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { email: SA_EMAIL, password: SA_PASSWORD },
    });

    if (!loginRes.ok()) {
      // SA user not seeded (demo environment) — skip this test
      test.skip(true, 'SA user not available in this environment');
      return;
    }

    const loginData = await loginRes.json();
    expect(loginData.data.mfa_required).toBe(true);
    expect(loginData.data.tempToken).toBeTruthy();

    // Try wrong TOTP code → should fail with 401
    const badMfaRes = await request.post(`${BASE_URL}/api/v1/mfa/verify`, {
      headers: { Authorization: `Bearer ${loginData.data.tempToken}` },
      data: { code: '000000' },
    });
    expect(badMfaRes.status()).toBe(401);
  });

  test('owner login does NOT require MFA', async ({ page }) => {
    test.setTimeout(60_000);

    await page.goto(`${BASE_URL}/auth/login`);
    await page.getByPlaceholder('admin@ys-matrix.com').fill(OWNER_EMAIL);
    await page.getByPlaceholder('••••••••').fill(OWNER_PASSWORD);
    await page.getByRole('button', { name: /دخول النظام|login/i }).click();

    // Owner should go directly to dashboard — no MFA screen
    await page.waitForURL('**/dashboard**', { timeout: 15_000 });
    await expect(page).toHaveURL(/\/dashboard/);
  });
});
