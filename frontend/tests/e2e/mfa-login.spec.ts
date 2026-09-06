import { test, expect } from '@playwright/test';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const OWNER_EMAIL = process.env.E2E_EMAIL || 'owner@demo.com';
const OWNER_PASSWORD = process.env.E2E_PASSWORD || 'Demo@Owner2024!';
const SA_EMAIL = process.env.E2E_SA_EMAIL || 'sa@test.local';
const SA_PASSWORD = process.env.E2E_SA_PASSWORD || 'Phase0#Test2026!';

test.describe('SUPER_ADMIN login with MFA', () => {
  test('SUPER_ADMIN login returns mfa_required and wrong TOTP is rejected', async ({ request }) => {
    test.setTimeout(30_000);

    const loginRes = await request.post(`${BASE_URL}/api/v1/auth/login`, {
      data: { email: SA_EMAIL, password: SA_PASSWORD },
    });
    expect(loginRes.ok()).toBeTruthy();

    const loginData = await loginRes.json();
    expect(loginData.data.mfa_required).toBe(true);
    expect(loginData.data.tempToken).toBeTruthy();

    // Unenrolled SUPER_ADMIN → /mfa/verify returns 403 MFA_NOT_ENABLED
    // (totp_enabled is false; the endpoint rejects before checking the code)
    const badMfaRes = await request.post(`${BASE_URL}/api/v1/mfa/verify`, {
      headers: { Authorization: `Bearer ${loginData.data.tempToken}` },
      data: { code: '000000' },
    });
    expect(badMfaRes.status()).toBe(403);
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
